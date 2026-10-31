import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Constant-time
 * compare; fails closed when the secret is unset or empty (never "open").
 */
export function isAuthorizedCron(
  headers: Headers,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret) return false;
  const provided = headers.get("authorization");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
