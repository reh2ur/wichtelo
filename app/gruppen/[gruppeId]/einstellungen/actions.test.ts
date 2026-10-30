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

import {
  addExclusion,
  updateGroupInfo,
  regenerateInviteLink,
  removeMember,
} from "./actions";
import { rotateToken } from "@/lib/invite";
import { removeMembership } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Thenable query builder resolving to `result` at any point in the chain. */
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "insert"]) q[m] = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue(result);
  // Lookups use maybeSingle; it follows whatever `single` is mocked to.
  q.maybeSingle = (...args: unknown[]) =>
    (q.single as (...a: unknown[]) => unknown)(...args);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}

function setup(opts: {
  state?: "open" | "drawn";
  memberIds: string[];
  /** members with a deleted account (profile_id null) */
  ghostIds?: string[];
  /** ids returned for the two-member membership check */
  pairFound?: number;
  exclusions?: { member_a: string; member_b: string }[];
  insertError?: { code: string; message: string } | null;
}) {
  const { state = "open", memberIds, insertError = null } = opts;
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
    },
  } as never);
  const exclusionInsert = vi.fn(() => query({ error: insertError }));
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "groups")
        return query({
          data: { id: "g1", slug: "s", name: "G", year: 2026, state },
        });
      if (table === "memberships") {
        const q = query({
          data: memberIds.map((id) => ({
            id,
            profile_id: opts.ghostIds?.includes(id) ? null : `p-${id}`,
          })),
          role: "admin",
        });
        // assertAdmin uses .single() -> caller membership
        (q.single as ReturnType<typeof vi.fn>).mockResolvedValue({
          data: { id: "m-admin", role: "admin" },
        });
        // pair check uses .in(); full list uses plain select
        (q.in as ReturnType<typeof vi.fn>).mockImplementation(() =>
          query({
            data: memberIds.slice(0, opts.pairFound ?? 2).map((id) => ({ id })),
          }),
        );
        return q;
      }
      if (table === "exclusions") {
        const q = query({ data: opts.exclusions ?? [] });
        q.insert = exclusionInsert;
        return q;
      }
      return query({ data: null });
    }),
  } as never);
  return { exclusionInsert };
}

describe("addExclusion (#201)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects members that are not in the group and inserts nothing", async () => {
    const { exclusionInsert } = setup({
      memberIds: ["a", "b", "c", "d"],
      pairFound: 1,
    });
    const res = await addExclusion(
      { status: "idle" },
      fd({ slug: "s", memberA: "a", memberB: "other-group-member" }),
    );
    expect(res).toEqual({ status: "error", error: "invalid_member" });
    expect(exclusionInsert).not.toHaveBeenCalled();
  });

  it("warns when the exclusion makes the draw impossible (3 members)", async () => {
    setup({
      memberIds: ["a", "b", "c"],
      exclusions: [{ member_a: "a", member_b: "b" }],
    });
    const res = await addExclusion(
      { status: "idle" },
      fd({ slug: "s", memberA: "a", memberB: "b" }),
    );
    expect(res).toEqual({ status: "success", warning: "unsolvable" });
  });

  it("succeeds without warning when the draw stays feasible", async () => {
    setup({
      memberIds: ["a", "b", "c", "d", "e"],
      exclusions: [{ member_a: "a", member_b: "b" }],
    });
    const res = await addExclusion(
      { status: "idle" },
      fd({ slug: "s", memberA: "a", memberB: "b" }),
    );
    expect(res).toEqual({ status: "success" });
  });
});

describe("addExclusion feasibility ignores ghosts in drawn groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not count ghost members (3 live + 2 ghosts, all pairs but one excluded -> unsolvable only if ghosts ignored)", async () => {
    // Live a,b,c with a-b excluded is unsolvable (3 members). With ghosts
    // counted (5 members) it would look feasible and hide the warning.
    setup({
      state: "drawn",
      memberIds: ["a", "b", "c", "g1", "g2"],
      ghostIds: ["g1", "g2"],
      exclusions: [{ member_a: "a", member_b: "b" }],
    });
    const res = await addExclusion(
      { status: "idle" },
      fd({ slug: "s", memberA: "a", memberB: "b" }),
    );
    expect(res).toEqual({ status: "success", warning: "unsolvable" });
  });
});

describe("updateGroupInfo too-long input (#186)", () => {
  it("returns too_long with echoed values for a 101-char name", async () => {
    const res = await updateGroupInfo(
      { status: "idle" },
      fd({ slug: "s", name: "x".repeat(101), budgetHint: "10 Euro" }),
    );
    expect(res).toEqual({
      status: "error",
      error: "too_long",
      max: 100,
      values: { name: "x".repeat(101), budgetHint: "10 Euro", note: "" },
    });
  });
});

describe("regenerateInviteLink (#187)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rotates the token for an admin of an open group", async () => {
    setup({ memberIds: ["a", "b", "c"] });
    vi.mocked(rotateToken).mockResolvedValue("new-token");
    const res = await regenerateInviteLink(
      { status: "idle" },
      fd({ slug: "s" }),
    );
    expect(res).toEqual({ status: "success" });
    expect(rotateToken).toHaveBeenCalledWith("g1");
  });

  it("refuses after the draw", async () => {
    setup({ state: "drawn", memberIds: ["a", "b", "c"] });
    const res = await regenerateInviteLink(
      { status: "idle" },
      fd({ slug: "s" }),
    );
    expect(res).toEqual({ status: "error", error: "drawn" });
    expect(rotateToken).not.toHaveBeenCalled();
  });

  it("maps rotation failures to generic", async () => {
    setup({ memberIds: ["a", "b", "c"] });
    vi.mocked(rotateToken).mockRejectedValue(new Error("db down"));
    const res = await regenerateInviteLink(
      { status: "idle" },
      fd({ slug: "s" }),
    );
    expect(res).toEqual({ status: "error", error: "generic" });
  });
});

describe("removeMember (#18)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets an admin remove a member of a drawn group", async () => {
    setup({ state: "drawn", memberIds: ["a", "b", "c"] });
    vi.mocked(removeMembership).mockResolvedValue({ result: "ok" });
    const res = await removeMember(
      { status: "idle" },
      fd({ slug: "s", membershipId: "m-target" }),
    );
    expect(res).toEqual({ status: "success" });
    expect(removeMembership).toHaveBeenCalledWith(
      expect.anything(),
      "g1",
      "m-target",
      { allowDrawn: true },
    );
  });

  it("maps last_admin from the locked removal", async () => {
    setup({ memberIds: ["a", "b", "c"] });
    vi.mocked(removeMembership).mockResolvedValue({ result: "last_admin" });
    const res = await removeMember(
      { status: "idle" },
      fd({ slug: "s", membershipId: "m-target" }),
    );
    expect(res).toEqual({ status: "error", error: "last_admin" });
  });

  it("maps DB failures to generic", async () => {
    setup({ memberIds: ["a", "b", "c"] });
    vi.mocked(removeMembership).mockResolvedValue({
      result: "error",
      reason: "boom",
    });
    const res = await removeMember(
      { status: "idle" },
      fd({ slug: "s", membershipId: "m-target" }),
    );
    expect(res).toEqual({ status: "error", error: "generic" });
  });
});

describe("assertAdmin DB errors (#139)", () => {
  beforeEach(() => vi.clearAllMocks());

  function failing(table: "groups" | "memberships") {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((t: string) => {
        const q = query(
          t === table
            ? { data: null, error: { message: "db down" } }
            : { data: { id: "g1", role: "admin" }, error: null },
        );
        return q;
      }),
    } as never);
  }

  it.each(["groups", "memberships"] as const)(
    "a %s lookup error returns generic, not not_admin",
    async (table) => {
      failing(table);
      const res = await removeMember(
        { status: "idle" },
        fd({ slug: "s", membershipId: "m-target" }),
      );
      expect(res).toEqual({ status: "error", error: "generic" });
      expect(removeMembership).not.toHaveBeenCalled();
    },
  );
});
