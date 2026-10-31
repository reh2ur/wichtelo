import { describe, it, expect } from "vitest";
import { isAuthorizedCron } from "./cron-auth";

const h = (value?: string) =>
  new Headers(value ? { authorization: value } : {});

describe("isAuthorizedCron", () => {
  const secret = "s".repeat(32);

  it("accepts the exact bearer", () => {
    expect(isAuthorizedCron(h(`Bearer ${secret}`), secret)).toBe(true);
  });

  it("rejects missing, wrong, prefix and scheme-less values", () => {
    expect(isAuthorizedCron(h(), secret)).toBe(false);
    expect(isAuthorizedCron(h("Bearer wrong"), secret)).toBe(false);
    expect(isAuthorizedCron(h(`Bearer ${secret}x`), secret)).toBe(false);
    expect(isAuthorizedCron(h(`Bearer ${secret.slice(0, -1)}`), secret)).toBe(
      false,
    );
    expect(isAuthorizedCron(h(secret), secret)).toBe(false);
  });

  it("fails closed when the secret is unset or empty", () => {
    expect(isAuthorizedCron(h("Bearer undefined"), undefined)).toBe(false);
    expect(isAuthorizedCron(h("Bearer "), "")).toBe(false);
  });
});
