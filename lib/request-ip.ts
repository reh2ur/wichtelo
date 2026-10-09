import { headers } from "next/headers";
import { logger } from "@/lib/logger";

// Used to key IP-based OTP rate limiting. `x-forwarded-for` is client-settable
// and Vercel's edge appends rather than overwrites it, so a spoofed value
// could land at index [0]. `x-vercel-forwarded-for` is set by Vercel's edge
// network itself and cannot be overridden by the client — see
// https://vercel.com/docs/edge-network/headers#x-vercel-forwarded-for
//
// When neither trusted header is present, callers (see lib/rate-limit.ts)
// key their Redis rate-limit bucket on the literal string "unknown" — every
// such request collapses onto one shared bucket, so one client can exhaust
// it for every other client hitting this fallback. On Vercel this should
// never happen in practice (the edge always sets x-vercel-forwarded-for), so
// log loudly when it does — see issue #137.
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  const vercelForwardedFor = headersList.get("x-vercel-forwarded-for");
  if (vercelForwardedFor) return vercelForwardedFor.split(",")[0].trim();

  const realIp = headersList.get("x-real-ip");
  if (realIp) return realIp;

  logger
    .withMetadata({
      hasForwardedFor: headersList.get("x-forwarded-for") !== null,
    })
    .warn("request-ip.unknown_fallback");
  return "unknown";
}
