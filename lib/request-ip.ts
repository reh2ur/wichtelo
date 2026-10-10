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
  if (vercelForwardedFor) {
    return normalizeIpKey(vercelForwardedFor.split(",")[0].trim());
  }

  const realIp = headersList.get("x-real-ip");
  if (realIp) return normalizeIpKey(realIp);

  logger
    .withMetadata({
      hasForwardedFor: headersList.get("x-forwarded-for") !== null,
    })
    .warn("request-ip.unknown_fallback");
  return "unknown";
}

/**
 * Rate-limit key for an IP. IPv4 stays as is. IPv6 collapses to its /64
 * prefix: one subscriber typically controls a whole /64, so keying by the full
 * address would hand an attacker 2^64 fresh buckets. IPv4-mapped IPv6
 * (`::ffff:1.2.3.4`) is keyed as the plain IPv4. Unparseable input is
 * returned unchanged (lowercased).
 */
export function normalizeIpKey(ip: string): string {
  const value = ip.trim().toLowerCase();
  if (!value.includes(":")) return value;

  const noZone = value.split("%")[0];
  const mapped = /^(?:0{0,4}:){2,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(
    noZone,
  );
  if (mapped) return mapped[1];

  const groups = expandIpv6(noZone);
  if (!groups) return value;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

function expandIpv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}
