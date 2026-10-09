import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Redis unconfigured (local dev/tests) — limiters are null and checkRateLimit
// always allows, so app-level rate limiting is opt-in via env vars. In
// production this must be loud, since silent fail-open removes rate
// limiting from every sensitive flow with no signal anywhere.
if (!redis && process.env.NODE_ENV === "production") {
  logger
    .withMetadata({ NODE_ENV: process.env.NODE_ENV })
    .error("rate-limit.unconfigured_in_production");
}
function makeLimiter(
  prefix: string,
  limit: number,
  window: Parameters<typeof Ratelimit.fixedWindow>[1],
): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(limit, window),
    prefix: `ratelimit:${prefix}`,
  });
}

// Separate prefixes per flow (not shared `otp-request`/`otp-verify` buckets):
// /anmelden (existing-user login) and /einladung/[token] (invite join) are
// independent flows. A shared bucket meant exhausting one from an IP (e.g.
// testing invite joins) silently blocked the other (e.g. that same admin's
// /anmelden login) with no indication which flow caused it — see issue #134.
//
// OTP *request* limits: primary limiter keyed by normalized email (10/h) so
// several people testing from one IP don't lock each other out; looser per-IP
// backstop (30/h, separate prefix) stops one IP spraying many addresses.
export const anmeldenOtpRequestLimiter = makeLimiter(
  "otp-request-anmelden-email",
  10,
  "1 h",
);
export const anmeldenOtpRequestIpLimiter = makeLimiter(
  "otp-request-anmelden-ip",
  30,
  "1 h",
);
export const anmeldenOtpVerifyLimiter = makeLimiter(
  "otp-verify-anmelden",
  5,
  "15 m",
);
export const inviteOtpRequestLimiter = makeLimiter(
  "otp-request-invite-email",
  10,
  "1 h",
);
export const inviteOtpRequestIpLimiter = makeLimiter(
  "otp-request-invite-ip",
  30,
  "1 h",
);
export const inviteOtpVerifyLimiter = makeLimiter(
  "otp-verify-invite",
  5,
  "15 m",
);
export const groupCreateLimiter = makeLimiter("group-create", 5, "24 h");
export const drawTriggerLimiter = makeLimiter("draw-trigger", 10, "1 h");
// Join/leave each email every admin — cap per user so an invite holder can't
// loop join/leave to flood admins or burn the Resend quota (#182).
export const joinLeaveLimiter = makeLimiter("join-leave", 10, "1 h");
export const exclusionAddLimiter = makeLimiter("exclusion-add", 30, "1 h");
export const accountDeletionLimiter = makeLimiter(
  "account-deletion",
  1,
  "24 h",
);

export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit(identifier);
  return success;
}
