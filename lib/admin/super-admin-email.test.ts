import { describe, it, expect } from "vitest";
import { isSuperAdminEmail } from "./super-admin-email";

describe("isSuperAdminEmail", () => {
  it("matches case-insensitively in both directions", () => {
    expect(isSuperAdminEmail("admin@example.com", "Admin@Example.COM")).toBe(
      true,
    );
    expect(isSuperAdminEmail("ADMIN@example.com", "admin@example.com")).toBe(
      true,
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(
      isSuperAdminEmail(" admin@example.com ", "admin@example.com\n"),
    ).toBe(true);
  });

  it("rejects other addresses", () => {
    expect(isSuperAdminEmail("other@example.com", "admin@example.com")).toBe(
      false,
    );
  });

  it("never matches when env is unset or blank", () => {
    expect(isSuperAdminEmail("admin@example.com", "")).toBe(false);
    expect(isSuperAdminEmail("admin@example.com", "  ")).toBe(false);
    expect(isSuperAdminEmail("", "")).toBe(false);
  });

  it("never matches a missing user email", () => {
    expect(isSuperAdminEmail(undefined, "admin@example.com")).toBe(false);
    expect(isSuperAdminEmail(null, "admin@example.com")).toBe(false);
  });
});
