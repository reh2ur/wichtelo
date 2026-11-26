import { describe, it, expect } from "vitest";
import { verifyDistribution } from "./verify";

const ids = ["a", "b", "c", "d"];
const ring = [
  { giver: "a", receiver: "b" },
  { giver: "b", receiver: "c" },
  { giver: "c", receiver: "d" },
  { giver: "d", receiver: "a" },
];

describe("verifyDistribution", () => {
  it("accepts a valid ring", () => {
    const r = verifyDistribution({
      memberIds: ids,
      pairs: ring,
      exclusions: [["a", "c"]],
    });
    expect(r.ok).toBe(true);
    expect(r.exclusionCount).toBe(1);
  });

  it("flags self assignment", () => {
    const r = verifyDistribution({
      memberIds: ids,
      pairs: [{ giver: "a", receiver: "a" }, ...ring.slice(1, 3)],
      exclusions: [],
    });
    expect(r.selfAssigned).toEqual(["a"]);
    expect(r.ok).toBe(false);
  });

  it("flags mutual pairs once", () => {
    const r = verifyDistribution({
      memberIds: ids,
      pairs: [
        { giver: "a", receiver: "b" },
        { giver: "b", receiver: "a" },
        { giver: "c", receiver: "d" },
        { giver: "d", receiver: "c" },
      ],
      exclusions: [],
    });
    expect(r.mutualPairs).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(r.ok).toBe(false);
  });

  it("flags exclusion violations in either direction", () => {
    const r = verifyDistribution({
      memberIds: ids,
      pairs: ring,
      exclusions: [["b", "a"]],
    });
    // d→a is allowed, a→b violates the (a, b) exclusion.
    expect(r.exclusionViolations).toEqual([["a", "b"]]);
  });

  it("flags missing and duplicate givers and receivers", () => {
    const r = verifyDistribution({
      memberIds: ids,
      pairs: [
        { giver: "a", receiver: "b" },
        { giver: "a", receiver: "c" },
        { giver: "b", receiver: "c" },
      ],
      exclusions: [],
    });
    expect(r.multipleGiver).toEqual(["a"]);
    expect(r.missingGiver).toEqual(["c", "d"]);
    expect(r.multipleReceiver).toEqual(["c"]);
    expect(r.missingReceiver).toEqual(["a", "d"]);
    expect(r.ok).toBe(false);
  });

  it("flags endpoints outside the group", () => {
    const r = verifyDistribution({
      memberIds: ids,
      pairs: [...ring, { giver: "x", receiver: "a" }],
      exclusions: [],
    });
    expect(r.unknownEndpoints).toEqual(["x"]);
    expect(r.ok).toBe(false);
  });
});
