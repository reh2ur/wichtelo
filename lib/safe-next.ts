/** Cookie carrying the post-login target across the magic-link round trip. */
export const NEXT_COOKIE = "wichtelo_next";

const BASE = "http://safe-next.invalid";
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Encoded dot / slash / backslash in the path: some layers decode these before
// resolving, so never let them through.
const ENCODED_PATH_CHARS = /%(2e|2f|5c)/i;

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
    // Normalization collapses dot segments ("/.//evil.com" -> "//evil.com"),
    // so re-check the result: a protocol-relative path is an external redirect.
    const path = url.pathname + url.search + url.hash;
    if (!path.startsWith("/") || path.startsWith("//")) return null;
    if (path.includes("\\") || ENCODED_PATH_CHARS.test(url.pathname)) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}
