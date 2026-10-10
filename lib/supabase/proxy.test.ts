import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Res = { data: unknown; error: unknown };
const results: Record<string, Res> = {};
let userResult: { id: string } | null = { id: "u1" };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(results[table]),
      };
      return chain;
    },
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _u: string,
    _k: string,
    opts: {
      cookies: {
        setAll: (c: { name: string; value: string; options: object }[]) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: async () => {
        // Simulate a refresh-token rotation.
        opts.cookies.setAll([
          { name: "sb-rotated", value: "new-token", options: {} },
        ]);
        return { data: { claims: userResult ? { sub: "u1" } : null } };
      },
      getUser: async () => ({ data: { user: userResult } }),
    },
  }),
}));

import { updateSession } from "./proxy";

function req(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function isNotFoundRewrite(res: Response) {
  return (
    res.headers.get("x-middleware-rewrite")?.endsWith("/__not_found__") ?? false
  );
}

describe("updateSession", () => {
  beforeEach(() => {
    userResult = { id: "u1" };
    results.groups = { data: { id: "g1" }, error: null };
    results.memberships = { data: { id: "m1" }, error: null };
  });

  it("rewrites to not-found when group has no rows", async () => {
    results.groups = { data: null, error: null };
    const res = await updateSession(req("/gruppen/weg"));
    expect(isNotFoundRewrite(res)).toBe(true);
  });

  it("rewrites to not-found for non-member", async () => {
    results.memberships = { data: null, error: null };
    const res = await updateSession(req("/gruppen/abc"));
    expect(isNotFoundRewrite(res)).toBe(true);
  });

  it("lets the request through on a group lookup error", async () => {
    results.groups = { data: null, error: { message: "down" } };
    const res = await updateSession(req("/gruppen/abc"));
    expect(isNotFoundRewrite(res)).toBe(false);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets the request through on a membership lookup error", async () => {
    results.memberships = { data: null, error: { message: "down" } };
    const res = await updateSession(req("/gruppen/abc"));
    expect(isNotFoundRewrite(res)).toBe(false);
  });

  it("copies refreshed cookies onto the not-found rewrite", async () => {
    results.groups = { data: null, error: null };
    const res = await updateSession(req("/gruppen/weg"));
    expect(res.cookies.get("sb-rotated")?.value).toBe("new-token");
  });

  it("copies refreshed cookies onto the login redirect", async () => {
    userResult = null;
    const res = await updateSession(req("/gruppen"));
    expect(res.headers.get("location")).toContain("/anmelden");
    expect(res.cookies.get("sb-rotated")?.value).toBe("new-token");
  });

  it("copies refreshed cookies onto the guest-only redirect", async () => {
    const res = await updateSession(req("/anmelden"));
    expect(res.headers.get("location")).toContain("/gruppen");
    expect(res.cookies.get("sb-rotated")?.value).toBe("new-token");
  });
});
