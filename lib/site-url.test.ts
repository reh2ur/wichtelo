import { describe, it, expect } from "vitest";
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
