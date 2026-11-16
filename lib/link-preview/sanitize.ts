/**
 * Everything fetched from a third-party page is untrusted text. These helpers
 * normalise it (strip control chars, collapse whitespace, cap length) and only
 * accept https image URLs. Limits mirror the CHECKs in migration
 * 20261116120000_wish_link_preview.sql.
 */
const LINK_PREVIEW_LIMITS = {
  title: 300,
  imageUrl: 2000,
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g;

/** Plain text only (never rendered as HTML); null when nothing is left. */
export function sanitizeLinkTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > LINK_PREVIEW_LIMITS.title
    ? text.slice(0, LINK_PREVIEW_LIMITS.title).trimEnd()
    : text;
}

/** Absolute https URL without credentials/whitespace, else null. */
export function sanitizeImageUrl(raw: unknown, base?: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (
    !value ||
    /\s/.test(value) ||
    value.length > LINK_PREVIEW_LIMITS.imageUrl
  ) {
    return null;
  }
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || !url.hostname) return null;
    if (url.username || url.password) return null;
    const href = url.href;
    return href.length <= LINK_PREVIEW_LIMITS.imageUrl ? href : null;
  } catch {
    return null;
  }
}

/** Titles of bot walls / error pages that must never be prefilled as a wish title. */
const CHALLENGE_TITLE =
  /^(just a moment|vercel security checkpoint|attention required|access denied|robot or human|are you a robot|bot verification|security check|one more step|checking your browser|pardon our interruption|ein moment|zugriff verweigert|captcha|403 forbidden|404|not found|error)\b/i;

export function isChallengeTitle(title: string): boolean {
  return CHALLENGE_TITLE.test(title.trim());
}
