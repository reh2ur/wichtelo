import { timingSafeEqual } from "node:crypto";
import { isProductionDeploy } from "@/lib/env";

const E2E_SECRET_HEADER = "x-e2e-secret";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Single gate for E2E-only backdoors (`/api/test/*`, `devOtp` returns).
 * All must hold:
 *  1. `E2E_TEST_MODE=1` (explicit opt-in; set only in Vercel Preview / local e2e)
 *  2. not a production deploy (`VERCEL_ENV=production` or `isProductionDeploy()`), and `NEXT_PUBLIC_SUPABASE_URL` does not
 *     contain `SUPABASE_PROJECT_REF_LIVE` (when set)
 *  3. request header `x-e2e-secret` equals `E2E_TEST_SECRET` (constant-time)
 */
export function isTestBackdoorEnabled(headers: Headers): boolean {
  if (process.env.E2E_TEST_MODE !== "1") return false;

  if (process.env.VERCEL_ENV === "production" || isProductionDeploy()) {
    return false;
  }

  const liveRef = process.env.SUPABASE_PROJECT_REF_LIVE;
  if (liveRef && process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(liveRef)) {
    return false;
  }

  const expected = process.env.E2E_TEST_SECRET;
  const provided = headers.get(E2E_SECRET_HEADER);
  if (!expected || !provided) return false;

  return safeEqual(provided, expected);
}

/**
 * E2E-only: lets a spec simulate the per-address resend throttle (the dev-OTP
 * path skips Supabase, so it never fires). Callers must already have
 * established `isTestBackdoorEnabled`; this only inspects the request: a
 * resend (`resend=1`, set by the OtpStep callers) for an address whose local
 * part starts with `throttled-`.
 */
export function isSimulatedResendThrottle(
  email: string,
  formData: FormData,
): boolean {
  return (
    formData.get("resend") === "1" &&
    email.toLowerCase().startsWith("throttled-")
  );
}
