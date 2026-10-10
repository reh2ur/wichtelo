import { describe, it, expect } from "vitest";
import { isAuthRateLimitError, isAuthEmailThrottleError } from "./auth-errors";

describe("isAuthRateLimitError", () => {
  it("is true for HTTP 429", () => {
    expect(isAuthRateLimitError({ status: 429 })).toBe(true);
  });

  it.each([
    "over_request_rate_limit",
    "over_email_send_rate_limit",
    "over_sms_send_rate_limit",
  ])("is true for code %s", (code) => {
    expect(isAuthRateLimitError({ code })).toBe(true);
  });

  it("is false for other errors", () => {
    expect(isAuthRateLimitError({ status: 400, code: "otp_expired" })).toBe(
      false,
    );
    expect(isAuthRateLimitError({ status: 500 })).toBe(false);
    expect(isAuthRateLimitError({ code: "otp_disabled" })).toBe(false);
    expect(isAuthRateLimitError({})).toBe(false);
    expect(isAuthRateLimitError(null)).toBe(false);
  });
});

describe("isAuthEmailThrottleError", () => {
  it("is true for over_email_send_rate_limit", () => {
    expect(
      isAuthEmailThrottleError({
        status: 429,
        code: "over_email_send_rate_limit",
      }),
    ).toBe(true);
  });

  it("is true for legacy 429 without code but with the throttle message", () => {
    expect(
      isAuthEmailThrottleError({
        status: 429,
        message:
          "For security purposes, you can only request this after 59 seconds.",
      }),
    ).toBe(true);
  });

  it("is false for generic request rate limits and other errors", () => {
    expect(
      isAuthEmailThrottleError({
        status: 429,
        code: "over_request_rate_limit",
      }),
    ).toBe(false);
    expect(isAuthEmailThrottleError({ status: 429 })).toBe(false);
    expect(isAuthEmailThrottleError({ code: "otp_disabled" })).toBe(false);
    expect(isAuthEmailThrottleError(null)).toBe(false);
  });
});
