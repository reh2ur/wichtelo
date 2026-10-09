import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows when no limiter is configured (redis unset)", async () => {
    expect(await checkRateLimit(null, "some-key")).toBe(true);
  });
});

describe("unconfigured Upstash env in production", () => {
  const errorMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    errorMock.mockClear();
    vi.doMock("@/lib/logger", () => ({
      logger: { withMetadata: () => ({ error: errorMock }) },
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/logger");
  });

  it("logs an error when NODE_ENV is production and Upstash env vars are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    await import("./rate-limit");

    expect(errorMock).toHaveBeenCalledWith(
      "rate-limit.unconfigured_in_production",
    );
  });

  it("does not log when NODE_ENV is not production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    await import("./rate-limit");

    expect(errorMock).not.toHaveBeenCalled();
  });

  it("does not log when Upstash env vars are present in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");

    await import("./rate-limit");

    expect(errorMock).not.toHaveBeenCalled();
  });
});

// Issue #134: /anmelden and /einladung/[token] must not share an OTP rate
// limit bucket — exhausting one flow from an IP silently blocked the other
// with no error surfaced on the invite side.
describe("per-flow OTP limiter isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives /anmelden and /einladung distinct limiter instances", async () => {
    const {
      anmeldenOtpRequestLimiter,
      anmeldenOtpVerifyLimiter,
      inviteOtpRequestLimiter,
      inviteOtpVerifyLimiter,
    } = await import("./rate-limit");

    expect(anmeldenOtpRequestLimiter).not.toBeNull();
    expect(inviteOtpRequestLimiter).not.toBeNull();
    expect(anmeldenOtpRequestLimiter).not.toBe(inviteOtpRequestLimiter);
    expect(anmeldenOtpVerifyLimiter).not.toBe(inviteOtpVerifyLimiter);
  });
});
