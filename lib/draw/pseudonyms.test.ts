import { describe, it, expect } from "vitest";
import { pseudonymLabel, pseudonymize } from "./pseudonyms";

describe("pseudonymLabel", () => {
  it("counts A..Z then AA, AB", () => {
    expect(pseudonymLabel(0)).toBe("A");
    expect(pseudonymLabel(25)).toBe("Z");
    expect(pseudonymLabel(26)).toBe("AA");
    expect(pseudonymLabel(27)).toBe("AB");
    expect(pseudonymLabel(26 + 26 * 26)).toBe("AAA");
  });
});

describe("pseudonymize", () => {
  const members = ["m1", "m2", "m3", "m4", "m5", "m6"];

  it("assigns every member a unique label and round-trips", () => {
    const p = pseudonymize("g1", 1, members);
    expect(new Set(p.labelById.values()).size).toBe(members.length);
    for (const id of members) {
      expect(p.idByLabel.get(p.labelById.get(id)!)).toBe(id);
    }
    expect([...p.idByLabel.keys()].sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
  });

  it("is stable regardless of input order", () => {
    const a = pseudonymize("g1", 1, members);
    const b = pseudonymize("g1", 1, [...members].reverse());
    expect([...a.labelById]).toEqual(expect.arrayContaining([...b.labelById]));
  });

  it("changes with draw version and group", () => {
    const base = [...pseudonymize("g1", 1, members).labelById.entries()];
    const redraw = [...pseudonymize("g1", 2, members).labelById.entries()];
    const other = [...pseudonymize("g2", 1, members).labelById.entries()];
    expect(redraw).not.toEqual(base);
    expect(other).not.toEqual(base);
  });
});
