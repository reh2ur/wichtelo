import { describe, expect, it } from "vitest";
import { hardenCookieOptions } from "./cookie-options";

describe("hardenCookieOptions", () => {
  it("forces secure and httpOnly on every cookie", () => {
    const result = hardenCookieOptions("sb-abc-auth-token", {
      maxAge: 34560000,
      sameSite: "lax",
    });
    expect(result.secure).toBe(true);
    expect(result.httpOnly).toBe(true);
    expect(result.sameSite).toBe("lax");
  });

  it("shortens max-age for the PKCE code-verifier cookie", () => {
    const result = hardenCookieOptions("sb-abc-auth-token-code-verifier", {
      maxAge: 34560000,
    });
    expect(result.maxAge).toBe(30 * 60);
  });

  it("leaves max-age untouched for non-verifier cookies", () => {
    const result = hardenCookieOptions("sb-abc-auth-token", {
      maxAge: 34560000,
    });
    expect(result.maxAge).toBe(34560000);
  });
});
