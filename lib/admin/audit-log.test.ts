import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./auth-users", () => ({ getAuthUsersById: vi.fn() }));

import {
  DEFAULT_AUDIT_LIMIT,
  fetchAuditLog,
  resolveTargetHref,
} from "./audit-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUsersById } from "./auth-users";

type Result = { data: unknown; error: { message: string } | null };

function row(over: Record<string, unknown>) {
  return {
    id: "a1",
    actor_email: "root@example.com",
    action: "delete_user",
    target_type: "user",
    target_id: "u1",
    metadata: null,
    created_at: "2026-10-01T10:00:00Z",
    ...over,
  };
}

/** Admin client double: audit log query + `groups` existence query. */
function setup(opts: { log: Result; groups?: Result }) {
  const limit = vi.fn().mockResolvedValue(opts.log);
  const order = vi.fn(() => ({ limit }));
  const groupsIn = vi.fn().mockResolvedValue(opts.groups ?? { data: [], error: null });
  const from = vi.fn((table: string) =>
    table === "admin_audit_log"
      ? { select: vi.fn(() => ({ order })) }
      : { select: vi.fn(() => ({ in: groupsIn })) },
  );
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { limit, order, groupsIn, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthUsersById).mockResolvedValue(new Map());
});

describe("fetchAuditLog", () => {
  it("reads newest first with the default limit", async () => {
    const { order, limit } = setup({ log: { data: [], error: null } });
    expect(await fetchAuditLog()).toEqual([]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(DEFAULT_AUDIT_LIMIT);
  });

  it("honours an explicit limit", async () => {
    const { limit } = setup({ log: { data: [], error: null } });
    await fetchAuditLog(5);
    expect(limit).toHaveBeenCalledWith(5);
  });

  it("throws on a DB error instead of returning an empty log", async () => {
    setup({ log: { data: null, error: { message: "db down" } } });
    await expect(fetchAuditLog()).rejects.toThrow("[fetchAuditLog] failed: db down");
  });

  it("treats null data without error as an empty log and skips target lookups", async () => {
    const { groupsIn } = setup({ log: { data: null, error: null } });
    expect(await fetchAuditLog()).toEqual([]);
    expect(groupsIn).not.toHaveBeenCalled();
  });

  it("maps rows and flags which user/group targets still exist", async () => {
    const { groupsIn } = setup({
      log: {
        data: [
          row({ id: "a1", target_type: "user", target_id: "u-live" }),
          row({ id: "a2", target_type: "user", target_id: "u-gone" }),
          row({
            id: "a3",
            target_type: "group",
            target_id: "g-live",
            action: "delete_group",
            metadata: { name: "Familie" },
          }),
          row({ id: "a4", target_type: "group", target_id: "g-gone" }),
        ],
        error: null,
      },
      groups: { data: [{ id: "g-live" }], error: null },
    });
    vi.mocked(getAuthUsersById).mockResolvedValue(
      new Map([
        ["u-live", { id: "u-live" } as never],
        ["u-gone", null],
      ]),
    );

    const entries = await fetchAuditLog();

    expect(getAuthUsersById).toHaveBeenCalledWith(expect.anything(), [
      "u-live",
      "u-gone",
    ]);
    // Only group targets are queried, de-duplicated and bounded to the rows.
    expect(groupsIn).toHaveBeenCalledWith("id", ["g-live", "g-gone"]);
    expect(entries.map((e) => [e.id, e.targetExists])).toEqual([
      ["a1", true],
      ["a2", false],
      ["a3", true],
      ["a4", false],
    ]);
    expect(entries[2]).toEqual({
      id: "a3",
      actorEmail: "root@example.com",
      action: "delete_group",
      targetType: "group",
      targetId: "g-live",
      targetExists: true,
      metadata: { name: "Familie" },
      createdAt: "2026-10-01T10:00:00Z",
    });
  });

  it("de-duplicates group ids and skips the groups query when no group rows exist", async () => {
    const dup = setup({
      log: {
        data: [
          row({ id: "a1", target_type: "group", target_id: "g1" }),
          row({ id: "a2", target_type: "group", target_id: "g1" }),
        ],
        error: null,
      },
    });
    await fetchAuditLog();
    expect(dup.groupsIn).toHaveBeenCalledWith("id", ["g1"]);

    const none = setup({ log: { data: [row({})], error: null } });
    await fetchAuditLog();
    expect(none.groupsIn).not.toHaveBeenCalled();
  });

  it("throws when the group existence lookup fails", async () => {
    setup({
      log: {
        data: [row({ target_type: "group", target_id: "g1" })],
        error: null,
      },
      groups: { data: null, error: { message: "boom" } },
    });
    await expect(fetchAuditLog()).rejects.toThrow("[fetchAuditLog] groups: boom");
  });

  it("propagates a failing auth user lookup", async () => {
    setup({ log: { data: [row({})], error: null } });
    vi.mocked(getAuthUsersById).mockRejectedValue(new Error("auth down"));
    await expect(fetchAuditLog()).rejects.toThrow("auth down");
  });
});

describe("resolveTargetHref", () => {
  it("links existing users and groups to their admin pages", () => {
    expect(
      resolveTargetHref({ targetType: "user", targetId: "u1", targetExists: true }),
    ).toBe("/admin/benutzer/u1");
    expect(
      resolveTargetHref({ targetType: "group", targetId: "g1", targetExists: true }),
    ).toBe("/admin/gruppen/g1");
  });

  it("returns null for deleted targets", () => {
    expect(
      resolveTargetHref({ targetType: "user", targetId: "u1", targetExists: false }),
    ).toBeNull();
    expect(
      resolveTargetHref({ targetType: "group", targetId: "g1", targetExists: false }),
    ).toBeNull();
  });
});
