interface DistributionPair {
  giver: string;
  receiver: string;
}

export interface DistributionInput {
  memberIds: string[];
  pairs: DistributionPair[];
  /** Bidirectional exclusion pairs. */
  exclusions: [string, string][];
}

export interface DistributionCheck {
  /** Members with no outgoing assignment. */
  missingGiver: string[];
  /** Members with more than one outgoing assignment. */
  multipleGiver: string[];
  /** Members nobody gives to. */
  missingReceiver: string[];
  /** Members that receive from more than one giver. */
  multipleReceiver: string[];
  selfAssigned: string[];
  /** A→B and B→A, each pair once (sorted). */
  mutualPairs: [string, string][];
  /** Assignments that go against an exclusion, each pair once (sorted). */
  exclusionViolations: [string, string][];
  /** Pair endpoints that are not members of the group. */
  unknownEndpoints: string[];
  /** Number of exclusion pairs that were checked. */
  exclusionCount: number;
  ok: boolean;
}

function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Pure audit of a drawn distribution against the draw rules: everyone gives
 * and receives exactly once, nobody draws themselves, no mutual pairs, no
 * excluded pair. Works on raw rows (not a giver map) so duplicate givers in a
 * broken state are reported, not silently collapsed.
 */
export function verifyDistribution(
  input: DistributionInput,
): DistributionCheck {
  const members = new Set(input.memberIds);
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const unknown = new Set<string>();
  const given = new Map<string, Set<string>>();

  for (const { giver, receiver } of input.pairs) {
    for (const id of [giver, receiver]) {
      if (!members.has(id)) unknown.add(id);
    }
    outgoing.set(giver, (outgoing.get(giver) ?? 0) + 1);
    incoming.set(receiver, (incoming.get(receiver) ?? 0) + 1);
    const set = given.get(giver) ?? new Set<string>();
    set.add(receiver);
    given.set(giver, set);
  }

  const withCount = (map: Map<string, number>, pred: (n: number) => boolean) =>
    input.memberIds.filter((id) => pred(map.get(id) ?? 0));

  const selfAssigned = input.memberIds.filter((id) => given.get(id)?.has(id));

  const mutual = new Map<string, [string, string]>();
  for (const [giver, receivers] of given) {
    for (const receiver of receivers) {
      if (giver !== receiver && given.get(receiver)?.has(giver)) {
        const pair = sortedPair(giver, receiver);
        mutual.set(pair.join("\u0000"), pair);
      }
    }
  }

  const violations = new Map<string, [string, string]>();
  for (const [a, b] of input.exclusions) {
    if (given.get(a)?.has(b) || given.get(b)?.has(a)) {
      const pair = sortedPair(a, b);
      violations.set(pair.join("\u0000"), pair);
    }
  }

  const result = {
    missingGiver: withCount(outgoing, (n) => n === 0),
    multipleGiver: withCount(outgoing, (n) => n > 1),
    missingReceiver: withCount(incoming, (n) => n === 0),
    multipleReceiver: withCount(incoming, (n) => n > 1),
    selfAssigned,
    mutualPairs: [...mutual.values()],
    exclusionViolations: [...violations.values()],
    unknownEndpoints: [...unknown],
    exclusionCount: input.exclusions.length,
  };

  const ok =
    result.missingGiver.length === 0 &&
    result.multipleGiver.length === 0 &&
    result.missingReceiver.length === 0 &&
    result.multipleReceiver.length === 0 &&
    result.selfAssigned.length === 0 &&
    result.mutualPairs.length === 0 &&
    result.exclusionViolations.length === 0 &&
    result.unknownEndpoints.length === 0;

  return { ...result, ok };
}
