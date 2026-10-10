import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/request-ip";
import { checkRateLimit, linkConfirmIpLimiter } from "@/lib/rate-limit";
import { isAuthRateLimitError } from "@/lib/supabase/auth-errors";
import { logger } from "@/lib/logger";

/** `?error=` flags the confirm pages/actions redirect back with. */
export type EmailLinkError = "link_invalid" | "rate_limited";

const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{8,200}$/;

/** Returns the token hash from a search-param value, or null when unusable. */
export function parseTokenHash(
  value: string | string[] | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return TOKEN_HASH_RE.test(trimmed) ? trimmed : null;
}

/** Maps an `?error=` search param to a known flag (unknown values -> null). */
export function parseEmailLinkError(
  value: string | string[] | null | undefined,
): EmailLinkError | null {
  return value === "link_invalid" || value === "rate_limited" ? value : null;
}

/**
 * Consumes the one-time token behind an emailed sign-in link. Must only run
 * from an explicit POST (the confirm page button), never from a GET: link
 * scanners prefetch GETs and would burn the token (issue #24). Unlike the
 * PKCE `exchangeCodeForSession` flow this works from any browser/device.
 * `type: "email"` covers both the magic-link and the signup-confirmation mail.
 */
export async function verifyEmailLink(
  rawTokenHash: string,
): Promise<"ok" | EmailLinkError> {
  const tokenHash = parseTokenHash(rawTokenHash);
  if (!tokenHash) return "link_invalid";

  if (!(await checkRateLimit(linkConfirmIpLimiter, await getClientIp()))) {
    return "rate_limited";
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });
  if (!error) return "ok";

  if (isAuthRateLimitError(error)) return "rate_limited";
  logger
    .withMetadata({ status: error.status, code: error.code })
    .info("auth.email_link_rejected");
  return "link_invalid";
}
