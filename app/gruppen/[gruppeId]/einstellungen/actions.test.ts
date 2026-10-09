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
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import {
  addExclusion,
  updateGroupInfo,
  regenerateInviteLink,
  invalidateDeletedGroup,
} from "./actions";
import { updateTag } from "next/cache";
import { rotateToken } from "@/lib/invite";
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
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}

function setup(opts: {
  state?: "open" | "drawn";
  memberIds: string[];
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
          data: memberIds.map((id) => ({ id })),
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

describe("invalidateDeletedGroup", () => {
  function arrange(row: { id: string } | null) {
    vi.mocked(updateTag).mockClear();
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: row }),
          }),
        }),
      })),
    } as never);
  }

  it("expires the group tag once the group row is gone", async () => {
    arrange(null);
    await invalidateDeletedGroup("familie");
    expect(updateTag).toHaveBeenCalledWith("group-familie");
  });

  it("does nothing while the group still exists", async () => {
    arrange({ id: "g1" });
    await invalidateDeletedGroup("familie");
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("ignores invalid slugs", async () => {
    arrange(null);
    await invalidateDeletedGroup("");
    expect(updateTag).not.toHaveBeenCalled();
  });
});
