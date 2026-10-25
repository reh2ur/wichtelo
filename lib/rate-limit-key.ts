import { createHmac } from "node:crypto";
import { isProductionDeploy } from "@/lib/env";

// Reuses the existing server secret (domain-separated by the HMAC message
// prefix) instead of a new required env var. Dev/tests/previews fall back to
// a fixed value; real production throws (secret is also required at boot by
// lib/env.ts).
const DEV_SECRET = "dev-only-account-deletion-secret";

function getSecret(): string {
  const secret = process.env.ACCOUNT_DELETION_SECRET;
  if (secret) return secret;
  if (isProductionDeploy()) {
    throw new Error("ACCOUNT_DELETION_SECRET is not set");
  }
  return DEV_SECRET;
}

/**
 * Pseudonymous rate-limit identifier for an email address. Limiter keys land
 * in Upstash (US processor), so the raw address, which may be a third party's
 * typed into a public form, must never be part of them. Case-insensitive and
 * deterministic: same address, same key.
 */
export function rateLimitKey(email: string): string {
  return createHmac("sha256", getSecret())
    .update(`rate-limit-email:${email.trim().toLowerCase()}`)
    .digest("base64url");
}
