import { describe, expect, it } from "vitest";
import {
  computeDraw as computeDrawRaw,
  hasGhostMembers,
  liveMembers,
  hasPerfectMatching,
  TOO_COMPLEX,
  type Assignment,
  type MemberId,
} from "./index";

// Fixed seeds chosen to produce valid assignments for each group size,
// verified by running the implementation.
const SEED = 42;

// Tests below expect a decided outcome; budget exhaustion is a failure.
function computeDraw(
  ...args: Parameters<typeof computeDrawRaw>
): Assignment | null {
  const result = computeDrawRaw(...args);
  if (result === TOO_COMPLEX) throw new Error("unexpected TOO_COMPLEX");
  return result;
}

function assertValidAssignment(
  members: MemberId[],
  assignment: Assignment,
  exclusions: [MemberId, MemberId][] = [],
) {
  expect(assignment.size).toBe(members.length);

  const memberSet = new Set(members);
  const receiverSet = new Set<MemberId>();

  for (const [giver, receiver] of assignment) {
    // Every giver/receiver must be a known member
    expect(memberSet.has(giver)).toBe(true);
    expect(memberSet.has(receiver)).toBe(true);

    // No self-assignment
    expect(giver).not.toBe(receiver);

    // No mutual pair: receiver must not give back to giver
    expect(assignment.get(receiver)).not.toBe(giver);

    // Exclusions respected (bidirectional)
    for (const [a, b] of exclusions) {
      const isExcluded =
        (giver === a && receiver === b) || (giver === b && receiver === a);
      expect(isExcluded).toBe(false);
    }

    receiverSet.add(receiver);
  }

  // Every member receives exactly once (bijection)
  expect(receiverSet).toEqual(memberSet);
}

describe("computeDraw", () => {
  describe("minimum participant enforcement", () => {
    it("returns null for 0 members", () => {
      expect(computeDraw([], [], SEED)).toBeNull();
    });

    it("returns null for 1 member", () => {
      expect(computeDraw(["A"], [], SEED)).toBeNull();
    });

    it("returns null for 2 members", () => {
      expect(computeDraw(["A", "B"], [], SEED)).toBeNull();
    });

    it("returns a valid assignment for 3 members", () => {
      const members = ["A", "B", "C"];
      const result = computeDraw(members, [], SEED);
      expect(result).not.toBeNull();
      assertValidAssignment(members, result!);
    });
  });

  describe("derangement — no self-assignment", () => {
    it("never assigns a member to themselves across many seeds", () => {
      const members = ["A", "B", "C", "D"];
      for (let seed = 0; seed < 100; seed++) {
        const result = computeDraw(members, [], seed);
        if (result) {
          for (const [giver, receiver] of result) {
            expect(giver).not.toBe(receiver);
          }
        }
      }
    });
  });

  describe("no mutual pairs", () => {
    it("never produces A→B and B→A", () => {
      const members = ["A", "B", "C", "D", "E"];
      for (let seed = 0; seed < 100; seed++) {
        const result = computeDraw(members, [], seed);
        if (result) {
          for (const [giver, receiver] of result) {
            expect(result.get(receiver)).not.toBe(giver);
          }
        }
      }
    });
  });

  describe("exclusion pairs", () => {
    it("respects a single exclusion pair", () => {
      const members = ["A", "B", "C", "D"];
      const exclusions: [MemberId, MemberId][] = [["A", "B"]];
      for (let seed = 0; seed < 50; seed++) {
        const result = computeDraw(members, exclusions, seed);
        if (result) {
          assertValidAssignment(members, result, exclusions);
        }
      }
    });

    it("respects multiple exclusion pairs", () => {
      const members = ["A", "B", "C", "D", "E"];
      const exclusions: [MemberId, MemberId][] = [
        ["A", "B"],
        ["C", "D"],
      ];
      for (let seed = 0; seed < 50; seed++) {
        const result = computeDraw(members, exclusions, seed);
        if (result) {
          assertValidAssignment(members, result, exclusions);
        }
      }
    });

    it("treats exclusions as bidirectional", () => {
      // Exclusion (A, B) means neither A→B nor B→A
      const members = ["A", "B", "C", "D"];
      const exclusions: [MemberId, MemberId][] = [["A", "B"]];
      for (let seed = 0; seed < 100; seed++) {
        const result = computeDraw(members, exclusions, seed);
        if (result) {
          expect(result.get("A")).not.toBe("B");
          expect(result.get("B")).not.toBe("A");
        }
      }
    });
  });

  describe("unsolvable constraint detection", () => {
    it("returns null when all valid assignments are excluded", () => {
      // With 3 members the only valid derangements without mutual pairs are
      // A→B→C→A and A→C→B→A. Excluding (A,B), (A,C), (B,C) leaves no valid draw.
      const members = ["A", "B", "C"];
      const exclusions: [MemberId, MemberId][] = [
        ["A", "B"],
        ["A", "C"],
        ["B", "C"],
      ];
      expect(computeDraw(members, exclusions, SEED)).toBeNull();
    });

    it("returns null when exclusions make a valid derangement impossible", () => {
      // 4 members, exclude every possible non-self pair for A
      const members = ["A", "B", "C", "D"];
      const exclusions: [MemberId, MemberId][] = [
        ["A", "B"],
        ["A", "C"],
        ["A", "D"],
      ];
      expect(computeDraw(members, exclusions, SEED)).toBeNull();
    });

    it("returns null for 3 members with any single exclusion (truly impossible)", () => {
      // With exactly 3 members, the only derangements without mutual pairs
      // are the two 3-cycles A→B→C→A and A→C→B→A. A bidirectional exclusion
      // on any pair removes one edge from each cycle, so any single
      // exclusion makes the draw impossible.
      const members = ["A", "B", "C"];
      const allPairs: [MemberId, MemberId][] = [
        ["A", "B"],
        ["A", "C"],
        ["B", "C"],
      ];
      for (const pair of allPairs) {
        for (let seed = 0; seed < 10; seed++) {
          expect(computeDraw(members, [pair], seed)).toBeNull();
        }
      }
    });
  });

  describe("household infeasibility (perf, #22)", () => {
    function household(sizes: number[]): {
      members: MemberId[];
      exclusions: [MemberId, MemberId][];
    } {
      const members: MemberId[] = [];
      const exclusions: [MemberId, MemberId][] = [];
      sizes.forEach((size, h) => {
        const ids = Array.from({ length: size }, (_, i) => `h${h}m${i}`);
        members.push(...ids);
        for (let i = 0; i < ids.length; i++)
          for (let j = i + 1; j < ids.length; j++)
            exclusions.push([ids[i], ids[j]]);
      });
      return { members, exclusions };
    }

    it.each([
      [[9, 8]],
      [[10, 9]],
      [[10, 3, 3, 3]],
      [[11, 4, 4, 2]],
      [[12, 11]],
    ])("households %j: null in < 100 ms", (sizes) => {
      const { members, exclusions } = household(sizes);
      const t0 = performance.now();
      expect(computeDraw(members, exclusions, SEED)).toBeNull();
      expect(performance.now() - t0).toBeLessThan(100);
    });

    it("hasPerfectMatching true for feasible, false for Hall violation", () => {
      const ok = household([3, 3]);
      expect(hasPerfectMatching(ok.members, ok.exclusions)).toBe(true);
      const bad = household([4, 2]);
      expect(hasPerfectMatching(bad.members, bad.exclusions)).toBe(false);
    });

    it("returns TOO_COMPLEX (not null) when node budget is exhausted", () => {
      // Matching-feasible but mutual-pair-infeasible; budget 0 forces
      // exhaustion deterministically.
      const members = ["A", "B", "C", "D"];
      const ex: [MemberId, MemberId][] = [
        ["A", "B"],
        ["C", "D"],
        ["A", "C"],
        ["B", "D"],
      ];
      // Only A->D, B->C, C->B, D->A possible: mutual pairs, infeasible.
      expect(hasPerfectMatching(members, ex)).toBe(true);
      expect(computeDraw(members, ex, SEED)).toBeNull();
      expect(computeDrawRaw(members, ex, SEED, 0)).toBe(TOO_COMPLEX);
    });
  });

  describe("backtracking fallback — tightly-constrained but solvable groups", () => {
    // Regression cases from issue #166: uniform rejection sampling alone
    // fails these a significant fraction of the time even though valid
    // assignments exist. computeDraw must always resolve them now.

    function familyExclusions(families: MemberId[][]): [MemberId, MemberId][] {
      const exclusions: [MemberId, MemberId][] = [];
      for (const family of families) {
        for (let i = 0; i < family.length; i++) {
          for (let j = i + 1; j < family.length; j++) {
            exclusions.push([family[i], family[j]]);
          }
        }
      }
      return exclusions;
    }

    it("resolves 2 families of 5 with in-family exclusions", () => {
      const families = [
        ["A1", "A2", "A3", "A4", "A5"],
        ["B1", "B2", "B3", "B4", "B5"],
      ];
      const members = families.flat();
      const exclusions = familyExclusions(families);
      for (let seed = 0; seed < 20; seed++) {
        const result = computeDraw(members, exclusions, seed);
        expect(result).not.toBeNull();
        assertValidAssignment(members, result!, exclusions);
      }
    });

    it("resolves 2 families of 6 with in-family exclusions", () => {
      const families = [
        ["A1", "A2", "A3", "A4", "A5", "A6"],
        ["B1", "B2", "B3", "B4", "B5", "B6"],
      ];
      const members = families.flat();
      const exclusions = familyExclusions(families);
      for (let seed = 0; seed < 20; seed++) {
        const result = computeDraw(members, exclusions, seed);
        expect(result).not.toBeNull();
        assertValidAssignment(members, result!, exclusions);
      }
    });

    it("resolves 3 families of 6 with in-family exclusions", () => {
      const families = [
        ["A1", "A2", "A3", "A4", "A5", "A6"],
        ["B1", "B2", "B3", "B4", "B5", "B6"],
        ["C1", "C2", "C3", "C4", "C5", "C6"],
      ];
      const members = families.flat();
      const exclusions = familyExclusions(families);
      for (let seed = 0; seed < 20; seed++) {
        const result = computeDraw(members, exclusions, seed);
        expect(result).not.toBeNull();
        assertValidAssignment(members, result!, exclusions);
      }
    });

    it("resolves 9 members with a tight exclusion ring (178 valid solutions)", () => {
      const members = Array.from({ length: 9 }, (_, i) => `M${i}`);
      // Ring: each member excluded with its two neighbors
      const exclusions: [MemberId, MemberId][] = members.map((m, i) => [
        m,
        members[(i + 1) % members.length],
      ]);
      for (let seed = 0; seed < 20; seed++) {
        const result = computeDraw(members, exclusions, seed);
        expect(result).not.toBeNull();
        assertValidAssignment(members, result!, exclusions);
      }
    });
  });

  describe("property: output never violates constraints", () => {
    it("holds across randomized group sizes and exclusion sets", () => {
      for (let trial = 0; trial < 50; trial++) {
        const size = 3 + (trial % 10); // sizes 3..12
        const members = Array.from({ length: size }, (_, i) => `M${i}`);

        // Deterministic pseudo-random exclusion set derived from trial index
        const exclusions: [MemberId, MemberId][] = [];
        for (let i = 0; i < size; i++) {
          if ((i + trial) % 3 === 0) {
            const a = members[i];
            const b = members[(i + 1 + (trial % 3)) % size];
            if (a !== b) exclusions.push([a, b]);
          }
        }

        const result = computeDraw(members, exclusions, trial);
        if (result) {
          assertValidAssignment(members, result, exclusions);
        }
      }
    });
  });

  describe("group sizes", () => {
    const sizes = [3, 4, 5, 10, 20];

    for (const n of sizes) {
      it(`produces a valid assignment for ${n} members`, () => {
        const members = Array.from({ length: n }, (_, i) => `M${i}`);
        const result = computeDraw(members, [], SEED);
        expect(result).not.toBeNull();
        assertValidAssignment(members, result!);
      });
    }
  });

  describe("determinism", () => {
    it("returns the same assignment for the same seed", () => {
      const members = ["A", "B", "C", "D", "E"];
      const r1 = computeDraw(members, [], SEED);
      const r2 = computeDraw(members, [], SEED);
      expect(r1).toEqual(r2);
    });

    it("returns different assignments for different seeds", () => {
      const members = ["A", "B", "C", "D", "E", "F"];
      const results = new Set<string>();
      for (let seed = 0; seed < 20; seed++) {
        const r = computeDraw(members, [], seed);
        if (r) results.add(JSON.stringify([...r]));
      }
      // At least a few distinct outcomes across 20 seeds
      expect(results.size).toBeGreaterThan(3);
    });
  });
});

describe("hasGhostMembers", () => {
  it("is false when every member has a profile", () => {
    expect(hasGhostMembers([{ profile_id: "a" }, { profile_id: "b" }])).toBe(
      false,
    );
  });

  it("is true when any member lacks a profile", () => {
    expect(hasGhostMembers([{ profile_id: "a" }, { profile_id: null }])).toBe(
      true,
    );
  });
});

describe("liveMembers", () => {
  it("drops members without a profile and keeps order", () => {
    const rows = [
      { id: "a", profile_id: "pa" },
      { id: "g", profile_id: null },
      { id: "b", profile_id: "pb" },
    ];
    expect(liveMembers(rows).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("returns an empty list when everyone is a ghost", () => {
    expect(liveMembers([{ profile_id: null }])).toEqual([]);
  });
});
