import { describe, expect, it } from "vitest";
import { rateLimitKey } from "./rate-limit-key";

describe("rateLimitKey", () => {
  it("never contains the email", () => {
    const key = rateLimitKey("Alice@Example.com");
    expect(key.toLowerCase()).not.toContain("alice");
    expect(key.toLowerCase()).not.toContain("example");
    expect(key).not.toContain("@");
  });

  it("is deterministic and case/whitespace-insensitive", () => {
    expect(rateLimitKey("alice@example.com")).toBe(
      rateLimitKey(" Alice@Example.COM "),
    );
  });

  it("differs per address", () => {
    expect(rateLimitKey("alice@example.com")).not.toBe(
      rateLimitKey("bob@example.com"),
    );
  });
});
