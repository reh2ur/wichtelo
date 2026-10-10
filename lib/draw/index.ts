import { randomBytes } from "node:crypto";

export type MemberId = string;
export type Assignment = Map<MemberId, MemberId>;
export type ExclusionPair = [MemberId, MemberId];

/**
 * Members without a profile in an open group are deleted accounts (ghosts)
 * and must never be drawn (#244).
 */
export function hasGhostMembers(
  members: { profile_id: string | null }[],
): boolean {
  return members.some((m) => m.profile_id === null);
}

/**
 * Re-draw of a drawn group: deleted accounts (profile_id null) keep their row
 * after the draw but must not take part. perform_draw removes them atomically.
 */
export function liveMembers<T extends { profile_id: string | null }>(
  members: T[],
): T[] {
  return members.filter((m) => m.profile_id !== null);
}

const MAX_ATTEMPTS = 200;
const MIN_PARTICIPANTS = 3;

// Mulberry32 seeded PRNG — produces floats in [0, 1)
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// CSPRNG seed for production draws — deterministic seeds only for tests
function cryptoSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

function shuffle<T>(arr: T[], random: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Exhaustive randomized backtracking fallback with MRV ordering (most-constrained
// giver first). Explores every branch pruning only on constraints that can never
// be satisfied, so it returns null only when truly no valid assignment exists.
function backtrackSearch(
  members: MemberId[],
  exclusions: ExclusionPair[],
  random: () => number,
): Assignment | null {
  const staticForbidden = new Map<MemberId, Set<MemberId>>(
    members.map((m) => [m, new Set<MemberId>([m])]),
  );
  for (const [a, b] of exclusions) {
    staticForbidden.get(a)!.add(b);
    staticForbidden.get(b)!.add(a);
  }

  const assignment = new Map<MemberId, MemberId>();
  const usedReceivers = new Set<MemberId>();
  const unassigned = new Set<MemberId>(members);

  function candidatesFor(giver: MemberId): MemberId[] {
    const forbidden = staticForbidden.get(giver)!;
    const candidates: MemberId[] = [];
    for (const receiver of members) {
      if (usedReceivers.has(receiver)) continue;
      if (forbidden.has(receiver)) continue;
      // Mutual-pair check: receiver already assigned to give to this giver
      if (assignment.get(receiver) === giver) continue;
      candidates.push(receiver);
    }
    return candidates;
  }

  function dfs(): boolean {
    if (unassigned.size === 0) return true;

    // MRV: assign the giver with the fewest remaining candidates first —
    // dead ends surface immediately instead of after deep, fruitless recursion.
    let bestGiver: MemberId | null = null;
    let bestCandidates: MemberId[] = [];
    for (const giver of unassigned) {
      const candidates = candidatesFor(giver);
      if (candidates.length === 0) return false;
      if (bestGiver === null || candidates.length < bestCandidates.length) {
        bestGiver = giver;
        bestCandidates = candidates;
        if (candidates.length === 1) break;
      }
    }

    const giver = bestGiver!;
    const candidates = shuffle(bestCandidates, random);

    unassigned.delete(giver);
    for (const receiver of candidates) {
      assignment.set(giver, receiver);
      usedReceivers.add(receiver);

      if (dfs()) return true;

      assignment.delete(giver);
      usedReceivers.delete(receiver);
    }
    unassigned.add(giver);
    return false;
  }

  return dfs() ? new Map(assignment) : null;
}

/**
 * Computes a valid Secret Santa assignment.
 *
 * Guarantees:
 *   - Derangement: no participant is assigned to themselves
 *   - No mutual pairs: if A→B then B does not give to A
 *   - Exclusion pairs are respected (bidirectionally)
 *
 * Tries uniform rejection sampling first (fast path for lightly-constrained
 * groups), then falls back to an exhaustive randomized backtracking search.
 * Returns null if and only if no valid assignment exists, or if fewer than
 * 3 members are provided.
 */
export function computeDraw(
  members: MemberId[],
  exclusions: ExclusionPair[],
  seed = cryptoSeed(),
): Assignment | null {
  if (members.length < MIN_PARTICIPANTS) return null;

  const exclusionSet = new Set<string>(
    exclusions.flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]),
  );

  // Index for O(1) lookup of a member's position in the givers list
  const memberIndex = new Map<MemberId, number>(members.map((m, i) => [m, i]));

  const random = mulberry32(seed);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const receivers = shuffle([...members], random);

    let valid = true;
    for (let i = 0; i < members.length; i++) {
      const giver = members[i];
      const receiver = receivers[i];

      if (giver === receiver) {
        valid = false;
        break;
      }

      // Mutual-pair check: receiver must not give back to giver
      const receiverPos = memberIndex.get(receiver)!;
      if (receivers[receiverPos] === giver) {
        valid = false;
        break;
      }

      if (exclusionSet.has(`${giver}:${receiver}`)) {
        valid = false;
        break;
      }
    }

    if (valid) {
      const assignment: Assignment = new Map();
      for (let i = 0; i < members.length; i++) {
        assignment.set(members[i], receivers[i]);
      }
      return assignment;
    }
  }

  return backtrackSearch(members, exclusions, random);
}
