import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  exclusionAddLimiter: {},
}));
vi.mock("@/lib/invite", () => ({ rotateToken: vi.fn() }));
vi.mock("@/lib/membership", () => ({ removeMembership: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { promoteToAdmin, removeExclusion } from "./actions";
import { updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupTag } from "@/lib/cache-tags";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

type Result = { data?: unknown; error?: { message: string } | null };

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

/**
 * Admin client double. `results[table]` is consumed in order, one entry per
 * awaited/terminal query on that table. Every builder call is recorded.
 */
function setup(
  results: Partial<Record<string, Result[]>>,
  user: { id: string } | null = { id: "u-admin" },
) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
  const calls: Call[] = [];
  const queues = Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, [...(v ?? [])]]),
  );
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      const next = () => {
        const r = queues[table]?.shift();
        if (!r) throw new Error(`no mocked result left for ${table}`);
        return Promise.resolve({ data: null, error: null, ...r });
      };
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "update", "delete", "insert"])
        q[op] = vi.fn((...args: unknown[]) => {
          calls.push({ table, op, args });
          return q;
        });
      q.single = vi.fn(next);
      q.maybeSingle = q.single;
      q.then = (resolve: (v: unknown) => unknown) => next().then(resolve);
      return q;
    }),
  } as never);
  return { calls };
}

const GROUP = {
  data: { id: "g1", slug: "familie", name: "G", year: 2026, state: "open" },
};
const ADMIN = { data: { id: "m-admin", role: "admin", name_snapshot: "A" } };
const PARTICIPANT = {
  data: { id: "m-p", role: "participant", name_snapshot: "P" },
};

describe("removeExclusion", () => {
  beforeEach(() => vi.clearAllMocks());
  const input = { slug: "familie", memberA: "a", memberB: "b" };

  it("deletes exactly the group's pair and invalidates the group tag", async () => {
    const { calls } = setup({
      groups: [GROUP],
      memberships: [ADMIN],
      exclusions: [{ error: null }],
    });
    const res = await removeExclusion({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "success" });
    const exclusionCalls = calls.filter((c) => c.table === "exclusions");
    expect(exclusionCalls.map((c) => c.op)).toEqual([
      "delete",
      "eq",
      "eq",
      "eq",
    ]);
    expect(exclusionCalls.slice(1).map((c) => c.args)).toEqual([
      ["group_id", "g1"],
      ["member_a", "a"],
      ["member_b", "b"],
    ]);
    expect(updateTag).toHaveBeenCalledWith(groupTag("familie"));
  });

  it("rejects an anonymous caller without touching exclusions", async () => {
    const { calls } = setup({}, null);
    const res = await removeExclusion({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(calls).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("rejects a plain participant and deletes nothing", async () => {
    const { calls } = setup({ groups: [GROUP], memberships: [PARTICIPANT] });
    const res = await removeExclusion({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(calls.some((c) => c.table === "exclusions")).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("reports an unknown group", async () => {
    setup({ groups: [{ data: null }] });
    const res = await removeExclusion({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "group_not_found" });
  });

  it("reports a DB error on the delete as generic and does not invalidate", async () => {
    setup({
      groups: [GROUP],
      memberships: [ADMIN],
      exclusions: [{ error: { message: "db down" } }],
    });
    const res = await removeExclusion({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("reports a DB error on the admin lookup as generic, not not_admin", async () => {
    setup({ groups: [GROUP], memberships: [{ error: { message: "boom" } }] });
    const res = await removeExclusion({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "generic" });
  });
});

describe("promoteToAdmin", () => {
  beforeEach(() => vi.clearAllMocks());
  const input = { slug: "familie", membershipId: "m-target" };

  it("promotes a member with an account, scoped to the group", async () => {
    const { calls } = setup({
      groups: [GROUP],
      memberships: [ADMIN, { data: { profile_id: "p2" } }, { error: null }],
    });
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "success" });
    const update = calls.find((c) => c.op === "update");
    expect(update?.args).toEqual([{ role: "admin" }]);
    // Both the target read and the update are pinned to this group, so a
    // membership id from another group can never be promoted.
    const groupFilters = calls.filter(
      (c) => c.op === "eq" && c.args[0] === "group_id" && c.args[1] === "g1",
    );
    expect(groupFilters.length).toBeGreaterThanOrEqual(3);
    expect(updateTag).toHaveBeenCalledWith(groupTag("familie"));
  });

  it("rejects an anonymous caller", async () => {
    const { calls } = setup({}, null);
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(calls).toEqual([]);
  });

  it("rejects a plain participant and updates nothing", async () => {
    const { calls } = setup({ groups: [GROUP], memberships: [PARTICIPANT] });
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("reports an unknown group", async () => {
    setup({ groups: [{ data: null }] });
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "group_not_found" });
  });

  it("refuses a target that is not in this group", async () => {
    const { calls } = setup({
      groups: [GROUP],
      memberships: [ADMIN, { data: null }],
    });
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("refuses a ghost member (deleted account) with no_account", async () => {
    const { calls } = setup({
      groups: [GROUP],
      memberships: [ADMIN, { data: { profile_id: null } }],
    });
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "no_account" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("reports a DB error on the update as generic and does not invalidate", async () => {
    setup({
      groups: [GROUP],
      memberships: [
        ADMIN,
        { data: { profile_id: "p2" } },
        { error: { message: "db down" } },
      ],
    });
    const res = await promoteToAdmin({ status: "idle" }, fd(input));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
