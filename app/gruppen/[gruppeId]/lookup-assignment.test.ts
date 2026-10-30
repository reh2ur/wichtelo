import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  assignmentLookupLimiter: { name: "lookup" },
  drawTriggerLimiter: {},
  joinLeaveLimiter: {},
}));
vi.mock("@/lib/group-admins", () => ({
  resolveGroupContact: vi.fn(),
  getGroupAdminEmails: vi.fn(),
}));
vi.mock("@/lib/notification", () => ({ notify: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { lookupAssignment } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, assignmentLookupLimiter } from "@/lib/rate-limit";

function fd(slug: string, membershipId = "m2") {
  const f = new FormData();
  f.set("slug", slug);
  f.set("membershipId", membershipId);
  return f;
}

type Row = Record<string, unknown> | null;

function query(one: Row) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue({ data: one, error: null });
  q.maybeSingle = q.single;
  return q;
}

function setup(
  opts: {
    group?: Row;
    caller?: Row;
    auditError?: string;
    assignment?: Row;
  } = {},
) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-admin" } } }),
    },
  } as never);
  const insert = vi.fn().mockResolvedValue({
    error: opts.auditError ? { message: opts.auditError } : null,
  });
  const assignments = query(
    opts.assignment === undefined ? { receiver_id: "m3" } : opts.assignment,
  );
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "groups")
        return query(
          opts.group === undefined ? { id: "g1", state: "drawn" } : opts.group,
        );
      if (table === "assignments") return assignments;
      if (table === "assignment_lookups") return { insert };
      if (table === "memberships") {
        // Caller lookup and receiver lookup share the table.
        const caller =
          opts.caller === undefined
            ? { id: "m1", role: "admin", name_snapshot: "Clara Conrad" }
            : opts.caller;
        return query(caller);
      }
      return query(null);
    }),
  } as never);
  return { insert, assignments };
}

describe("lookupAssignment (#135)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
  });

  it("writes an audit row with actor, group and target before revealing", async () => {
    const { insert } = setup();
    const res = await lookupAssignment({ status: "idle" }, fd("familie"));
    expect(res).toEqual({
      status: "success",
      giverId: "m2",
      receiverName: "Clara Conrad",
    });
    expect(insert).toHaveBeenCalledWith({
      group_id: "g1",
      actor_profile_id: "u-admin",
      target_membership_id: "m2",
    });
  });

  it("fails closed when the audit row cannot be written", async () => {
    setup({ auditError: "db down" });
    const res = await lookupAssignment({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "generic" });
  });

  it("rate limits per admin and group, without auditing or revealing", async () => {
    const { insert, assignments } = setup();
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await lookupAssignment({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(
      assignmentLookupLimiter,
      "familie:u-admin",
    );
    expect(assignments.single).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an open group (e.g. stale rows after reopen) without auditing", async () => {
    const { insert, assignments } = setup({
      group: { id: "g1", state: "open" },
    });
    const res = await lookupAssignment({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_found" });
    expect(assignments.single).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("non-admin, non-member and unknown slug get the same error, nothing audited", async () => {
    const participant = setup({ caller: { id: "m2", role: "participant" } });
    const asParticipant = await lookupAssignment(
      { status: "idle" },
      fd("familie"),
    );
    expect(participant.insert).not.toHaveBeenCalled();

    const nonMember = setup({ caller: null });
    const asOutsider = await lookupAssignment(
      { status: "idle" },
      fd("familie"),
    );
    expect(nonMember.insert).not.toHaveBeenCalled();

    const unknown = setup({ group: null });
    const unknownSlug = await lookupAssignment({ status: "idle" }, fd("nope"));
    expect(unknown.insert).not.toHaveBeenCalled();

    expect(asParticipant).toEqual({ status: "error", error: "not_admin" });
    expect(asOutsider).toEqual(asParticipant);
    expect(unknownSlug).toEqual(asParticipant);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("does not audit when no assignment exists for the target", async () => {
    const { insert } = setup({ assignment: null });
    const res = await lookupAssignment({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_found" });
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["slug", { membershipId: "m2" }],
    ["membershipId", { slug: "familie" }],
    ["both", {}],
  ])("rejects missing %s before any auth or DB work", async (_l, fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    const res = await lookupAssignment({ status: "idle" }, f);
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("requires a signed-in user and reads no data", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);
    const res = await lookupAssignment({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_authenticated" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
