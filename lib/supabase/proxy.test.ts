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
    results.memberships = { data: { id: "m1", role: "admin" }, error: null };
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

  it("rewrites settings to not-found for a non-admin member", async () => {
    results.memberships = {
      data: { id: "m1", role: "participant" },
      error: null,
    };
    const res = await updateSession(req("/gruppen/abc/einstellungen"));
    expect(isNotFoundRewrite(res)).toBe(true);
  });

  it("rewrites settings to not-found for a non-member and unknown slug alike", async () => {
    results.memberships = { data: null, error: null };
    const a = await updateSession(req("/gruppen/abc/einstellungen"));
    results.groups = { data: null, error: null };
    const b = await updateSession(req("/gruppen/weg/einstellungen"));
    expect(isNotFoundRewrite(a)).toBe(true);
    expect(isNotFoundRewrite(b)).toBe(true);
  });

  it("lets an admin through to settings", async () => {
    const res = await updateSession(req("/gruppen/abc/einstellungen"));
    expect(isNotFoundRewrite(res)).toBe(false);
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes the original path as next on the login redirect", async () => {
    userResult = null;
    const res = await updateSession(req("/gruppen/abc?x=1"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/anmelden");
    expect(loc.searchParams.get("next")).toBe("/gruppen/abc?x=1");
  });

  it("omits next for the plain groups overview", async () => {
    userResult = null;
    const res = await updateSession(req("/gruppen"));
    expect(new URL(res.headers.get("location")!).search).toBe("");
  });

  it("honors a valid next on the guest-only redirect", async () => {
    const res = await updateSession(req("/anmelden?next=/gruppen/abc"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/gruppen/abc");
  });

  it("ignores an off-origin next on the guest-only redirect", async () => {
    const res = await updateSession(req("/anmelden?next=//evil.com"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("localhost");
    expect(loc.pathname).toBe("/gruppen");
  });
});
