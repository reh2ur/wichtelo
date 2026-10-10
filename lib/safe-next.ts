/** Cookie carrying the post-login target across the magic-link round trip. */
export const NEXT_COOKIE = "wichtelo_next";

const BASE = "http://safe-next.invalid";
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Validates a post-login return path. Accepts only same-origin relative paths
 * ("/gruppen/x?y=1"); anything else (absolute URLs, "//host", backslashes,
 * control chars, non-string) yields null so callers fall back to /gruppen.
 * Returns the normalized path+search+hash.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\") || CONTROL_CHARS.test(raw)) return null;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
