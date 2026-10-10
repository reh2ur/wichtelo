import { describe, it, expect, vi, beforeEach } from "vitest";

const results: Record<string, { data: unknown; error: unknown }> = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
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
    results.profiles = {
      data: { first_name: "Anna", last_name: "Beck" },
      error: null,
    };
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
    results.profiles = { data: null, error: { message: "boom" } };
    await expect(resolveToken("x")).rejects.toThrow(/admin profile/);
  });

  it("resolves a valid token", async () => {
    const r = await resolveToken("t");
    expect(r?.adminName).toBe("Anna B.");
  });
});
