import { describe, it, expect, vi, beforeEach } from "vitest";

const results: Record<string, { data: unknown; error: unknown }> = {};
const calls: { table: string; method: string; args: unknown[] }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      const chain = {
        select: record("select"),
        eq: record("eq"),
        not: record("not"),
        order: record("order"),
        limit: record("limit"),
        single: () => Promise.resolve(results[table]),
        maybeSingle: () => Promise.resolve(results[table]),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/logger", () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  return { logger: { withMetadata: () => log } };
});

import { resolveToken } from "./index";

const group = {
  id: "g1",
  slug: "s",
  name: "G",
  state: "open",
  created_by: "u1",
  budget_hint: null,
  note: null,
};

describe("resolveToken error handling", () => {
  beforeEach(() => {
    results.invite_tokens = {
      data: { token: "t", group_id: "g1", groups: group },
      error: null,
    };
    results.memberships = { data: { profile_id: "u2" }, error: null };
    results.profiles = {
      data: { first_name: "Anna", last_name: "Beck" },
      error: null,
    };
    calls.length = 0;
  });

  it("returns null when no row exists", async () => {
    results.invite_tokens = { data: null, error: null };
    expect(await resolveToken("x")).toBeNull();
  });

  it("throws (does not return null) on a token lookup error", async () => {
    results.invite_tokens = { data: null, error: { message: "boom" } };
    await expect(resolveToken("x")).rejects.toThrow(/token lookup failed/);
  });

  it("throws on an admin profile lookup error", async () => {
    results.invite_tokens = {
      data: {
        token: "t",
        group_id: "g1",
        groups: { ...group, state: "drawn" },
      },
      error: null,
    };
    results.profiles = { data: null, error: { message: "boom" } };
    await expect(resolveToken("x")).rejects.toThrow(/admin profile/);
  });

  it("throws on an admin membership lookup error", async () => {
    results.invite_tokens = {
      data: {
        token: "t",
        group_id: "g1",
        groups: { ...group, state: "drawn" },
      },
      error: null,
    };
    results.memberships = { data: null, error: { message: "boom" } };
    await expect(resolveToken("x")).rejects.toThrow(/admin membership/);
  });

  it("resolves an open group without looking up a contact", async () => {
    const r = await resolveToken("t");
    expect(r?.group.id).toBe("g1");
    expect(r?.adminName).toBe("");
    expect(calls).toEqual([
      expect.objectContaining({ table: "invite_tokens", method: "select" }),
      expect.objectContaining({ table: "invite_tokens", method: "eq" }),
    ]);
  });

  it("resolves an open group whose creator deleted their account", async () => {
    results.invite_tokens = {
      data: {
        token: "t",
        group_id: "g1",
        groups: { ...group, created_by: null },
      },
      error: null,
    };
    const r = await resolveToken("t");
    expect(r?.group.created_by).toBeNull();
    expect(r?.adminName).toBe("");
  });

  describe("drawn group", () => {
    beforeEach(() => {
      results.invite_tokens = {
        data: {
          token: "t",
          group_id: "g1",
          groups: { ...group, state: "drawn", created_by: null },
        },
        error: null,
      };
    });

    it("names a current admin even when created_by is null", async () => {
      const r = await resolveToken("t");
      expect(r?.adminName).toBe("Anna B.");
    });

    it("looks up the oldest live admin membership, not the creator", async () => {
      await resolveToken("t");
      const m = calls.filter((c) => c.table === "memberships");
      expect(m).toContainEqual(
        expect.objectContaining({ method: "eq", args: ["role", "admin"] }),
      );
      expect(m).toContainEqual(
        expect.objectContaining({
          method: "not",
          args: ["profile_id", "is", null],
        }),
      );
      expect(m).toContainEqual(
        expect.objectContaining({
          method: "order",
          args: ["joined_at", { ascending: true }],
        }),
      );
      expect(calls).toContainEqual(
        expect.objectContaining({
          table: "profiles",
          method: "eq",
          args: ["id", "u2"],
        }),
      );
    });

    it("falls back to empty name when no live admin exists", async () => {
      results.memberships = { data: null, error: null };
      const r = await resolveToken("t");
      expect(r?.adminName).toBe("");
    });
  });
});
