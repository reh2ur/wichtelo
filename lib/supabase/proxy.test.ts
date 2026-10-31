import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Res = { data: unknown; error: unknown };
const results: Record<string, Res> = {};
let userResult: { id: string; banned_until?: string | null } | null = {
  id: "u1",
};
let fromSpy: ((table: string) => void) | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      fromSpy?.(table);
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

// Proxy does ONE lookup: group inner-joined to the caller's own membership.
function setLookup(membership: { id: string; role: string } | null) {
  results.groups = {
    data: membership ? { id: "g1", memberships: [membership] } : null,
    error: null,
  };
}

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
    setLookup({ id: "m1", role: "admin" });
  });

  it("rewrites to not-found when group has no rows (unknown slug or non-member)", async () => {
    setLookup(null);
    const res = await updateSession(req("/gruppen/weg"));
    expect(isNotFoundRewrite(res)).toBe(true);
  });

  it("treats a banned user with a still-valid token as signed out", async () => {
    userResult = {
      id: "u1",
      banned_until: new Date(Date.now() + 3600_000).toISOString(),
    };
    const res = await updateSession(req("/gruppen"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/anmelden");
  });

  it("lets a user through whose ban already expired", async () => {
    userResult = {
      id: "u1",
      banned_until: new Date(Date.now() - 1000).toISOString(),
    };
    const res = await updateSession(req("/gruppen"));
    expect(res.status).toBe(200);
  });

  it("does only one DB lookup for group + membership", async () => {
    const tables: string[] = [];
    fromSpy = (t) => tables.push(t);
    await updateSession(req("/gruppen/abc"));
    fromSpy = null;
    expect(tables).toEqual(["groups"]);
  });

  it("lets the request through on a lookup error", async () => {
    results.groups = { data: null, error: { message: "down" } };
    const res = await updateSession(req("/gruppen/abc"));
    expect(isNotFoundRewrite(res)).toBe(false);
    expect(res.headers.get("location")).toBeNull();
  });

  it("copies refreshed cookies onto the not-found rewrite", async () => {
    setLookup(null);
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
    setLookup({ id: "m1", role: "participant" });
    const res = await updateSession(req("/gruppen/abc/einstellungen"));
    expect(isNotFoundRewrite(res)).toBe(true);
  });

  it("rewrites settings to not-found for a non-member and unknown slug alike", async () => {
    setLookup(null);
    const a = await updateSession(req("/gruppen/abc/einstellungen"));
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
