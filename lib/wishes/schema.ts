import { z } from "zod";

/** Mirrors the CHECK constraints in migration 20261113120000_wishes.sql. */
export const WISH_LIMITS = {
  title: 200,
  url: 2000,
  note: 1000,
  /** numeric(7,2) */
  priceMax: 99999.99,
  /** Per-account cap enforced by trigger `check_wish_integrity`. */
  perAccount: 500,
} as const;

interface WishInput {
  title: string;
  url: string | null;
  note: string | null;
  priceEstimate: number | null;
  groupId: string | null;
}

export interface WishRawInput {
  title?: string | null;
  url?: string | null;
  note?: string | null;
  price?: string | null;
  groupId?: string | null;
}

type WishFieldError =
  | { field: "title"; code: "required" }
  | { field: "title" | "url" | "note"; code: "too_long"; max: number }
  | { field: "url"; code: "invalid_url" }
  | { field: "price"; code: "invalid_price" }
  | { field: "group"; code: "invalid_group" };

export type ParsedWish =
  { ok: true; value: WishInput } | { ok: false; error: WishFieldError };

const groupIdSchema = z.uuid();
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PRICE = /^\d{1,5}(\.\d{1,2})?$/;

/**
 * Link normalisation: bare `example.com/x` gets `https://`; any explicit
 * scheme other than http/https (`javascript:`, `data:`, ...) is rejected.
 */
function normalizeUrl(
  raw: string,
): { ok: true; value: string } | { ok: false; error: WishFieldError } {
  const withScheme = SCHEME.test(raw) ? raw : `https://${raw}`;
  if (withScheme.length > WISH_LIMITS.url) {
    return {
      ok: false,
      error: { field: "url", code: "too_long", max: WISH_LIMITS.url },
    };
  }
  if (/\s/.test(withScheme)) {
    return { ok: false, error: { field: "url", code: "invalid_url" } };
  }
  try {
    const parsed = new URL(withScheme);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname
    ) {
      return { ok: false, error: { field: "url", code: "invalid_url" } };
    }
  } catch {
    return { ok: false, error: { field: "url", code: "invalid_url" } };
  }
  return { ok: true, value: withScheme };
}

/** "25", "24,90", "24.90" → number; anything else → null (invalid). */
function parsePrice(raw: string): number | null {
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  if (!PRICE.test(normalized)) return null;
  return Number(normalized);
}

/** Validates + normalises user input for a wish (quick-add and edit form). */
export function parseWishInput(raw: WishRawInput): ParsedWish {
  const title = (raw.title ?? "").trim();
  if (!title) return { ok: false, error: { field: "title", code: "required" } };
  if (title.length > WISH_LIMITS.title) {
    return {
      ok: false,
      error: { field: "title", code: "too_long", max: WISH_LIMITS.title },
    };
  }

  let url: string | null = null;
  const rawUrl = (raw.url ?? "").trim();
  if (rawUrl) {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized.ok) return normalized;
    url = normalized.value;
  }

  const note = (raw.note ?? "").trim() || null;
  if (note && note.length > WISH_LIMITS.note) {
    return {
      ok: false,
      error: { field: "note", code: "too_long", max: WISH_LIMITS.note },
    };
  }

  let priceEstimate: number | null = null;
  const rawPrice = (raw.price ?? "").trim();
  if (rawPrice) {
    priceEstimate = parsePrice(rawPrice);
    if (priceEstimate === null || priceEstimate > WISH_LIMITS.priceMax) {
      return { ok: false, error: { field: "price", code: "invalid_price" } };
    }
  }

  const rawGroup = (raw.groupId ?? "").trim();
  let groupId: string | null = null;
  if (rawGroup) {
    if (!groupIdSchema.safeParse(rawGroup).success) {
      return { ok: false, error: { field: "group", code: "invalid_group" } };
    }
    groupId = rawGroup;
  }

  return { ok: true, value: { title, url, note, priceEstimate, groupId } };
}
