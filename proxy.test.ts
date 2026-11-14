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

function req(path: string, ua = "Mozilla/5.0 (Macintosh) Safari/605.1.15") {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "user-agent": ua },
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

describe("proxy: link-preview crawlers", () => {
  const wa = "WhatsApp/2.23.20.0 A";
  const fb =
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

  beforeEach(() => {
    vi.clearAllMocks();
    inviteTokenExists.mockResolvedValue(true);
  });

  it.each([wa, fb, "Slackbot-LinkExpanding 1.0", "Twitterbot/1.0"])(
    "allows %s on the invite page and OG image",
    async (ua) => {
      expect((await proxy(req("/einladung/tok", ua))).status).not.toBe(403);
      expect((await proxy(req("/opengraph-image-1a2b3c", ua))).status).not.toBe(
        403,
      );
    },
  );

  it("still blocks bots elsewhere", async () => {
    expect((await proxy(req("/gruppen", fb))).status).toBe(403);
    expect((await proxy(req("/einladung/tok/magiclink", fb))).status).toBe(403);
  });

  it("bad token + crawler: real 404 rewrite", async () => {
    inviteTokenExists.mockResolvedValue(false);
    const res = await proxy(req("/einladung/bad", wa));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__not_found__");
  });
});
