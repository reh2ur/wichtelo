type AuthErrorLike = {
  status?: number;
  code?: string;
  message?: string;
} | null;

/**
 * Supabase Auth throttling of any kind: HTTP 429 or an `over_*_rate_limit`
 * code (`over_request_rate_limit`, `over_email_send_rate_limit`, ...).
 * Server-side calls all share Vercel's egress IPs, so Auth's per-IP limits
 * can trip for unrelated users; that is "try again later", not "wrong code".
 */
export function isAuthRateLimitError(error: AuthErrorLike): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  return /^over_.+_rate_limit$/.test(error.code ?? "");
}

/**
 * Per-address / project-wide email-send throttle (`max_frequency`,
 * `email_sent`). For an existing account a second quick OTP request hits this
 * while an unknown address never does, so /anmelden must not surface it
 * (account enumeration, issue #104).
 */
export function isAuthEmailThrottleError(error: AuthErrorLike): boolean {
  if (!error) return false;
  if (error.code === "over_email_send_rate_limit") return true;
  return (
    error.status === 429 &&
    !error.code &&
    /you can only request this after/i.test(error.message ?? "")
  );
}
