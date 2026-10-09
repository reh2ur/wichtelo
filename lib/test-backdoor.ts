import { timingSafeEqual } from "node:crypto";

export const E2E_SECRET_HEADER = "x-e2e-secret";

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
 *  2. not a Vercel Production deploy, and `NEXT_PUBLIC_SUPABASE_URL` does not
 *     contain `SUPABASE_PROJECT_REF_LIVE` (when set)
 *  3. request header `x-e2e-secret` equals `E2E_TEST_SECRET` (constant-time)
 */
export function isTestBackdoorEnabled(headers: Headers): boolean {
  if (process.env.E2E_TEST_MODE !== "1") return false;

  if (process.env.VERCEL_ENV === "production") return false;

  const liveRef = process.env.SUPABASE_PROJECT_REF_LIVE;
  if (liveRef && process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(liveRef)) {
    return false;
  }

  const expected = process.env.E2E_TEST_SECRET;
  const provided = headers.get(E2E_SECRET_HEADER);
  if (!expected || !provided) return false;

  return safeEqual(provided, expected);
}
