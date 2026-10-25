import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const inviteTokenExists = vi.fn();
vi.mock("@/lib/invite", () => ({
  inviteTokenExists: (token: string) => inviteTokenExists(token),
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
        return { data: { claims: null } };
      },
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));

import { proxy } from "./proxy";

function req(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" },
  });
}

describe("proxy: invite token 404", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites a bad token to /__not_found__ and keeps refreshed session cookies", async () => {
    inviteTokenExists.mockResolvedValue(false);
    const res = await proxy(req("/einladung/bad-token"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__not_found__");
    expect(res.cookies.get("sb-rotated")?.value).toBe("new-token");
  });

  it("passes a valid token through", async () => {
    inviteTokenExists.mockResolvedValue(true);
    const res = await proxy(req("/einladung/good-token"));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
