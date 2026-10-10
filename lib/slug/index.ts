// Matches combining diacritical marks produced by NFKD normalization
// (e.g. the dieresis left behind when "ï" decomposes to "i" + mark).
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  Ä: "ae",
  ö: "oe",
  Ö: "oe",
  ü: "ue",
  Ü: "ue",
  ß: "ss",
};

function transliterate(name: string): string {
  return name
    .replace(/[äÄöÖüÜß]/g, (c) => UMLAUTS[c])
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slugs that collide with static child routes of /gruppen. A group with such a
 * slug would be unreachable (the static route wins), so they get a suffix.
 */
const RESERVED_SLUGS: readonly string[] = ["neu"];

const SEQUENTIAL_ATTEMPTS = 5;
const RANDOM_SUFFIX_LENGTH = 4;

/**
 * Slug candidate for the nth insert attempt (0-based) when existing slugs are
 * unknown up front. Attempts 0..4 are `base`, `base-2`..`base-5` (readable);
 * later ones get a short random base36 suffix so popular names ("Familie")
 * never exhaust the namespace.
 */
export function slugCandidate(
  name: string,
  attempt: number,
  random: () => number = Math.random,
): string {
  const base = generateSlug(name, []);
  if (attempt === 0) return base;
  if (attempt < SEQUENTIAL_ATTEMPTS) return `${base}-${attempt + 1}`;
  let suffix = "";
  while (suffix.length < RANDOM_SUFFIX_LENGTH) {
    suffix += Math.floor(random() * 36).toString(36);
  }
  return `${base}-${suffix}`;
}

export function generateSlug(name: string, existingSlugs: string[]): string {
  const slugBase = transliterate(name) || "gruppe";
  const base = RESERVED_SLUGS.includes(slugBase)
    ? `${slugBase}-gruppe`
    : slugBase;
  if (!existingSlugs.includes(base)) return base;
  let n = 2;
  while (existingSlugs.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
