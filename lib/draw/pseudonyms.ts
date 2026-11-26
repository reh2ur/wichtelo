import { hmacWithServerSecret } from "@/lib/rate-limit-key";

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB" … */
export function pseudonymLabel(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface Pseudonyms {
  /** membership id → label ("A", "B", …) */
  labelById: Map<string, string>;
  /** label → membership id */
  idByLabel: Map<string, string>;
}

/**
 * Stable pseudonyms for one draw of one group. Labels are assigned in the
 * order of a keyed hash over group, draw version and membership id, so they
 * do not follow names, name length, join order or ids, stay the same across
 * reloads and are reshuffled by a re-draw. Only the server holds the key, so
 * a client cannot map a label back to a member on its own.
 */
export function pseudonymize(
  groupId: string,
  drawVersion: number,
  memberIds: string[],
): Pseudonyms {
  const ranked = memberIds
    .map((id) => ({
      id,
      key: hmacWithServerSecret(
        "distribution-pseudonym",
        `${groupId}:${drawVersion}:${id}`,
      ),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const labelById = new Map<string, string>();
  const idByLabel = new Map<string, string>();
  ranked.forEach(({ id }, i) => {
    const label = pseudonymLabel(i);
    labelById.set(id, label);
    idByLabel.set(label, id);
  });
  return { labelById, idByLabel };
}
