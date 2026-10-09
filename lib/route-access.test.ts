import { describe, expect, it } from "vitest";
import { isGuestOnlyRoute, isProtectedRoute } from "@/lib/route-access";

describe("isProtectedRoute", () => {
  it("protects registered protected routes and their sub-paths", () => {
    expect(isProtectedRoute("/gruppen")).toBe(true);
    expect(isProtectedRoute("/gruppen/abc-123")).toBe(true);
    expect(isProtectedRoute("/konto")).toBe(true);
    expect(isProtectedRoute("/admin")).toBe(true);
  });

  it("does not protect registered public or guest-only routes", () => {
    expect(isProtectedRoute("/")).toBe(false);
    expect(isProtectedRoute("/anmelden")).toBe(false);
    expect(isProtectedRoute("/impressum")).toBe(false);
    expect(isProtectedRoute("/datenschutz")).toBe(false);
  });

  it("keeps the emailed deletion-confirm page reachable without a session", () => {
    expect(isProtectedRoute("/konto/delete/confirm")).toBe(false);
    expect(isProtectedRoute("/konto/other")).toBe(true);
  });

  it("does not protect API, auth, or invite paths", () => {
    expect(isProtectedRoute("/api/foo")).toBe(false);
    expect(isProtectedRoute("/auth/callback")).toBe(false);
    expect(isProtectedRoute("/einladung/some-token")).toBe(false);
  });

  it("does not protect unknown routes, letting Next render a real 404", () => {
    expect(isProtectedRoute("/this-route-does-not-exist-xyz")).toBe(false);
    expect(isProtectedRoute("/robots.txt")).toBe(false);
    expect(isProtectedRoute("/sitemap.xml")).toBe(false);
  });
});

describe("isGuestOnlyRoute", () => {
  it("flags guest-only routes", () => {
    expect(isGuestOnlyRoute("/")).toBe(true);
    expect(isGuestOnlyRoute("/anmelden")).toBe(true);
  });

  it("does not flag other routes", () => {
    expect(isGuestOnlyRoute("/gruppen")).toBe(false);
    expect(isGuestOnlyRoute("/this-route-does-not-exist-xyz")).toBe(false);
  });
});
