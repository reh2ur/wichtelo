import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSiteUrl } from "./site-url";

describe("resolveSiteUrl", () => {
  it("production uses configured origin and ignores request headers", () => {
    expect(
      resolveSiteUrl({
        production: true,
        configured: "https://wichtelo.example/",
        host: "evil.vercel.app",
        forwardedHost: "evil.example",
        forwardedProto: "http",
      }),
    ).toBe("https://wichtelo.example");
  });

  it("production without configured origin throws", () => {
    expect(() => resolveSiteUrl({ production: true })).toThrow(
      "NEXT_PUBLIC_SITE_URL",
    );
  });

  it("dev derives origin from forwarded headers", () => {
    expect(
      resolveSiteUrl({
        production: false,
        forwardedHost: "preview.vercel.app",
        forwardedProto: "https",
      }),
    ).toBe("https://preview.vercel.app");
  });

  it("dev prefers x-forwarded-host over host and normalizes 127.0.0.1", () => {
    expect(resolveSiteUrl({ production: false, host: "127.0.0.1:3000" })).toBe(
      "http://localhost:3000",
    );
  });

  it("dev falls back to localhost:3000", () => {
    expect(resolveSiteUrl({ production: false })).toBe("http://localhost:3000");
  });
});

describe("getSiteUrl / buildInviteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("next/headers");
  });

  it("production invite URL uses canonical origin, not the request host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://wichtelo.de");
    vi.doMock("next/headers", () => ({
      headers: async () =>
        new Headers({
          host: "alias.vercel.app",
          "x-forwarded-host": "alias.vercel.app",
          "x-forwarded-proto": "https",
        }),
    }));
    const { getSiteUrl, buildInviteUrl } = await import("./site-url");
    expect(buildInviteUrl(await getSiteUrl(), "tok")).toBe(
      "https://wichtelo.de/einladung/tok",
    );
  });
});
