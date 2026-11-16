import {
  isChallengeTitle,
  sanitizeLinkBrand,
  trimTitleSuffix,
  sanitizeImageUrl,
  sanitizeLinkTitle,
} from "./sanitize";

export interface LinkPreview {
  title: string | null;
  imageUrl: string | null;
  /** Price in the form the wish form accepts ("24.90"), euro only. */
  price: string | null;
  /** `og:site_name` or JSON-LD `Product.brand`. */
  brand: string | null;
  /** https favicon / touch icon (hotlinked, never stored by us). */
  iconUrl: string | null;
}

const PRICE_MAX = 99999.99;
const PRICE_RE = /^\d{1,5}(\.\d{1,2})?$/;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1].toLowerCase() === "x"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
          return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

const ATTR_RE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** First value per meta key (`property` or `name`), lower-cased. */
function collectMeta(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = parseAttributes(m[1]);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
    const content = attrs.content;
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  return meta;
}

function collectJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const type = parseAttributes(m[1]).type?.toLowerCase().split(";")[0].trim();
    if (type !== "application/ld+json") continue;
    try {
      blocks.push(JSON.parse(m[2].trim()));
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  }
  return blocks;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Flattens arrays and `@graph` into a list of nodes. */
function flatten(node: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 5) return out;
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out, depth + 1);
  } else if (isObject(node)) {
    out.push(node);
    if ("@graph" in node) flatten(node["@graph"], out, depth + 1);
  }
  return out;
}

function hasType(node: Json, type: string): boolean {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function normalizePrice(raw: unknown): string | null {
  let text: string;
  if (typeof raw === "number") text = String(raw);
  else if (typeof raw === "string") text = raw.trim();
  else return null;
  text = text.replace(/\s/g, "");
  // "1.299,90" (de) vs "1,299.90" (en) vs "24,90" / "24.90"
  if (/,\d{1,2}$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(/,/g, "");
  if (!PRICE_RE.test(text)) return null;
  const value = Number(text);
  if (!(value >= 0) || value > PRICE_MAX) return null;
  return text;
}

function isEuro(currency: unknown): boolean {
  if (currency === undefined || currency === null || currency === "") {
    return true;
  }
  return (
    typeof currency === "string" && currency.trim().toUpperCase() === "EUR"
  );
}

function offerPrice(offers: unknown, depth = 0): string | null {
  if (depth > 3) return null;
  for (const offer of flatten(offers)) {
    if (!isEuro(offer.priceCurrency)) continue;
    const spec = isObject(offer.priceSpecification)
      ? offer.priceSpecification
      : null;
    const price =
      normalizePrice(offer.price) ??
      normalizePrice(offer.lowPrice) ??
      (spec && isEuro(spec.priceCurrency) ? normalizePrice(spec.price) : null);
    if (price) return price;
    const nested = offerPrice(offer.offers, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function jsonLdImage(image: unknown): unknown {
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const item of image) {
      const found = jsonLdImage(item);
      if (found) return found;
    }
    return null;
  }
  return isObject(image) ? (image.url ?? image.contentUrl) : null;
}

/** "€ 59,99", "59.99 €", "EUR 1.299,00" → "59.99" etc. First match wins. */
const TEXT_PRICE = [
  /(?:€|EUR)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i,
  /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(?:€|EUR\b)/i,
];

function priceFromText(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    for (const re of TEXT_PRICE) {
      const m = re.exec(text);
      const price = m ? normalizePrice(m[1]) : null;
      if (price) return price;
    }
  }
  return null;
}

function brandName(brand: unknown): unknown {
  return isObject(brand) ? brand.name : brand;
}

/** Best icon from `<link rel="…icon…">`; falls back to `/favicon.ico` of the page origin. */
function findIcon(html: string, baseUrl: string): string | null {
  let best: { href: string; rank: number } | null = null;
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = parseAttributes(m[1]);
    const rel = attrs.rel?.toLowerCase().split(/\s+/) ?? [];
    if (
      !attrs.href ||
      !rel.some((r) => r === "icon" || r === "apple-touch-icon")
    )
      continue;
    const rank = rel.includes("apple-touch-icon") ? 2 : 1;
    if (!best || rank > best.rank) best = { href: attrs.href, rank };
  }
  const found = best && sanitizeImageUrl(best.href, baseUrl);
  if (found) return found;
  try {
    return sanitizeImageUrl(new URL("/favicon.ico", baseUrl).href);
  } catch {
    return null;
  }
}

function titleTag(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

/**
 * Best-effort extraction of title, image and price from page HTML. Pure and
 * total: malformed input yields nulls, never throws. `baseUrl` resolves
 * relative image URLs. Everything is sanitised (plain text, https images).
 */
export function parseLinkPreview(html: string, baseUrl: string): LinkPreview {
  const meta = collectMeta(html);
  const nodes = collectJsonLd(html).flatMap((b) => flatten(b));
  const products = nodes.filter((n) => hasType(n, "Product"));

  const productName = products
    .map((p) => sanitizeLinkTitle(p.name))
    .find(Boolean);
  const rawTitle =
    sanitizeLinkTitle(meta.get("og:title")) ??
    productName ??
    sanitizeLinkTitle(meta.get("twitter:title")) ??
    sanitizeLinkTitle(titleTag(html));
  // Bot walls answer 200 with a generic title; prefilling it would be wrong.
  const title =
    rawTitle && !isChallengeTitle(rawTitle) ? trimTitleSuffix(rawTitle) : null;

  let imageUrl = sanitizeImageUrl(meta.get("og:image:secure_url"), baseUrl);
  imageUrl ??= sanitizeImageUrl(meta.get("og:image"), baseUrl);
  for (const p of products) {
    imageUrl ??= sanitizeImageUrl(jsonLdImage(p.image), baseUrl);
  }
  imageUrl ??= sanitizeImageUrl(meta.get("twitter:image"), baseUrl);

  const metaCurrency =
    meta.get("product:price:currency") ?? meta.get("og:price:currency");
  let price: string | null = null;
  if (isEuro(metaCurrency)) {
    price =
      normalizePrice(meta.get("product:price:amount")) ??
      normalizePrice(meta.get("og:price:amount"));
  }
  for (const p of products) {
    price ??= offerPrice(p.offers);
  }

  // Fallback: a price written into title / description ("… - €59.99 - Shop").
  price ??= priceFromText(
    meta.get("og:title"),
    titleTag(html),
    meta.get("og:description"),
    meta.get("description"),
  );

  let brand = sanitizeLinkBrand(meta.get("og:site_name"));
  for (const p of products) {
    brand ??= sanitizeLinkBrand(brandName(p.brand));
  }

  return { title, imageUrl, price, brand, iconUrl: findIcon(html, baseUrl) };
}
