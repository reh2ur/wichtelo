import { describe, expect, it } from "vitest";
import { availablePartnerIds, pairableIds } from "./exclusion-options";

const ids = ["a", "b", "c"];

describe("availablePartnerIds", () => {
  it("returns all members when nothing selected", () => {
    expect(availablePartnerIds(ids, [], "")).toEqual(ids);
  });

  it("omits the selected member itself", () => {
    expect(availablePartnerIds(ids, [], "a")).toEqual(["b", "c"]);
  });

  it("omits already excluded partner in both directions", () => {
    const ex = [{ memberA: "a", memberB: "b" }];
    expect(availablePartnerIds(ids, ex, "a")).toEqual(["c"]);
    expect(availablePartnerIds(ids, ex, "b")).toEqual(["c"]);
    expect(availablePartnerIds(ids, ex, "c")).toEqual(["a", "b"]);
  });

  it("returns empty when excluded with everyone", () => {
    const ex = [
      { memberA: "a", memberB: "b" },
      { memberA: "c", memberB: "a" },
    ];
    expect(availablePartnerIds(ids, ex, "a")).toEqual([]);
  });
});

describe("pairableIds", () => {
  it("drops members with no remaining partner", () => {
    const ex = [
      { memberA: "a", memberB: "b" },
      { memberA: "a", memberB: "c" },
    ];
    expect(pairableIds(ids, ex)).toEqual(["b", "c"]);
  });
});
