import { describe, expect, it } from "vitest";
import { abbreviateNames, membersFromMemberships, type Member } from ".";

function m(id: string, firstName: string, lastName: string): Member {
  return { id, firstName, lastName };
}

describe("abbreviateNames", () => {
  describe("degenerate inputs", () => {
    it("returns an empty array for an empty input", () => {
      expect(abbreviateNames([])).toEqual([]);
    });

    it("returns a single first-name-only entry for one member", () => {
      expect(abbreviateNames([m("1", "Max", "Mustermann")])).toEqual([
        { id: "1", displayName: "Max" },
      ]);
    });
  });

  describe("all first names unique", () => {
    it("omits last names entirely when no first-name collisions exist", () => {
      const result = abbreviateNames([
        m("1", "Max", "Mustermann"),
        m("2", "Anna", "Schmidt"),
        m("3", "Klaus", "Mueller"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Max" },
        { id: "2", displayName: "Anna" },
        { id: "3", displayName: "Klaus" },
      ]);
    });
  });

  describe("two members share a first name", () => {
    it("appends the minimum disambiguating last-name prefix", () => {
      const result = abbreviateNames([
        m("1", "Max", "Mustermann"),
        m("2", "Max", "Schmidt"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Max M." },
        { id: "2", displayName: "Max S." },
      ]);
    });

    it("extends the suffix when the first character is shared", () => {
      const result = abbreviateNames([
        m("1", "Max", "Mustermann"),
        m("2", "Max", "Meier"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Max Mu." },
        { id: "2", displayName: "Max Me." },
      ]);
    });

    it("extends the suffix further when several characters are shared", () => {
      const result = abbreviateNames([
        m("1", "Anna", "Schneider"),
        m("2", "Anna", "Schmidt"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Anna Schn." },
        { id: "2", displayName: "Anna Schm." },
      ]);
    });
  });

  describe("partial collisions", () => {
    it("only suffixes the duplicates, not the unique first names", () => {
      const result = abbreviateNames([
        m("1", "Max", "Mustermann"),
        m("2", "Max", "Schmidt"),
        m("3", "Anna", "Mueller"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Max M." },
        { id: "2", displayName: "Max S." },
        { id: "3", displayName: "Anna" },
      ]);
    });

    it("disambiguates each cohort independently", () => {
      const result = abbreviateNames([
        m("1", "Max", "Mustermann"),
        m("2", "Max", "Schmidt"),
        m("3", "Anna", "Schneider"),
        m("4", "Anna", "Schmidt"),
        m("5", "Klaus", "Mueller"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Max M." },
        { id: "2", displayName: "Max S." },
        { id: "3", displayName: "Anna Schn." },
        { id: "4", displayName: "Anna Schm." },
        { id: "5", displayName: "Klaus" },
      ]);
    });
  });

  describe("three or more members with the same first name", () => {
    it("finds the minimum prefix that distinguishes all members in the cohort", () => {
      const result = abbreviateNames([
        m("1", "Max", "Mustermann"),
        m("2", "Max", "Meier"),
        m("3", "Max", "Schmidt"),
      ]);
      expect(result).toEqual([
        { id: "1", displayName: "Max Mu." },
        { id: "2", displayName: "Max Me." },
        { id: "3", displayName: "Max S." },
      ]);
      // All three suffixes share length determined by the longest-needed pair (Mu/Me)
      const suffixes = result.map((r) => r.displayName.split(" ")[1]);
      const unique = new Set(suffixes);
      expect(unique.size).toBe(3);
    });
  });

  describe("ordering and identity", () => {
    it("preserves input order", () => {
      const result = abbreviateNames([
        m("c", "Anna", "X"),
        m("a", "Max", "Mustermann"),
        m("b", "Max", "Schmidt"),
      ]);
      expect(result.map((r) => r.id)).toEqual(["c", "a", "b"]);
    });
  });
});

describe("membersFromMemberships", () => {
  it("uses linked profile's first/last name when present", () => {
    const result = membersFromMemberships(
      [{ id: "m1", name_snapshot: "Stale Name", profile_id: "p1" }],
      new Map([["p1", { first_name: "Max", last_name: "Mustermann" }]]),
    );
    expect(result).toEqual([
      { id: "m1", firstName: "Max", lastName: "Mustermann" },
    ]);
  });

  it("falls back to splitting name_snapshot when profile_id is null", () => {
    const result = membersFromMemberships(
      [{ id: "m1", name_snapshot: "Anna Schmidt", profile_id: null }],
      new Map(),
    );
    expect(result).toEqual([
      { id: "m1", firstName: "Anna", lastName: "Schmidt" },
    ]);
  });

  it("falls back when profile_id set but profile missing from map", () => {
    const result = membersFromMemberships(
      [{ id: "m1", name_snapshot: "Klaus Mueller", profile_id: "missing" }],
      new Map(),
    );
    expect(result).toEqual([
      { id: "m1", firstName: "Klaus", lastName: "Mueller" },
    ]);
  });

  it("handles single-word name_snapshot fallback", () => {
    const result = membersFromMemberships(
      [{ id: "m1", name_snapshot: "Cher", profile_id: null }],
      new Map(),
    );
    expect(result).toEqual([{ id: "m1", firstName: "Cher", lastName: "" }]);
  });
});

describe("abbreviateNames edge cases", () => {
  it("disambiguates identical full names with a counter", () => {
    const result = abbreviateNames([
      m("1", "Anna", "Meier"),
      m("2", "Anna", "Meier"),
      m("3", "Bob", "Klein"),
    ]);
    expect(result.map((r) => r.displayName)).toEqual([
      "Anna Meier (1)",
      "Anna Meier (2)",
      "Bob",
    ]);
  });

  it("disambiguates same first name with empty last names", () => {
    const result = abbreviateNames([m("1", "Anna", ""), m("2", "Anna", "")]);
    expect(result.map((r) => r.displayName)).toEqual(["Anna (1)", "Anna (2)"]);
    expect(new Set(result.map((r) => r.displayName)).size).toBe(2);
  });

  it("omits the trailing period when the last name is shown in full", () => {
    // "Mu" is a prefix of "Mustermann", so it cannot be shortened further.
    const result = abbreviateNames([
      m("1", "Max", "Mu"),
      m("2", "Max", "Mustermann"),
    ]);
    expect(result).toEqual([
      { id: "1", displayName: "Max Mu" },
      { id: "2", displayName: "Max Mus." },
    ]);
  });

  it("keeps the trailing period for a one-character last name only when truncated", () => {
    const result = abbreviateNames([
      m("1", "Max", "M"),
      m("2", "Max", "Schmidt"),
    ]);
    expect(result).toEqual([
      { id: "1", displayName: "Max M" },
      { id: "2", displayName: "Max S." },
    ]);
  });

  it("never splits surrogate pairs when abbreviating", () => {
    const result = abbreviateNames([
      m("1", "Anna", "😀Smith"),
      m("2", "Anna", "Meier"),
    ]);
    expect(result[0].displayName).toBe("Anna 😀.");
    expect(result[0].displayName).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });
});

describe("membersFromMemberships name snapshots", () => {
  it("uses separately stored first/last snapshot instead of re-splitting", () => {
    const result = membersFromMemberships(
      [
        {
          id: "1",
          name_snapshot: "Anna Maria Müller",
          first_name_snapshot: "Anna Maria",
          last_name_snapshot: "Müller",
          profile_id: null,
        },
      ],
      new Map(),
    );
    expect(result).toEqual([
      { id: "1", firstName: "Anna Maria", lastName: "Müller" },
    ]);
  });
});

describe("abbreviateNames normalization (#153)", () => {
  it("treats NFC and NFD first names as the same cohort", () => {
    const nfc = "Zo\u00eb";
    const nfd = "Zoe\u0308";
    const result = abbreviateNames([
      { id: "1", firstName: nfc, lastName: "Meier" },
      { id: "2", firstName: nfd, lastName: "Schmidt" },
    ]);
    expect(result[0].displayName).toBe(`${nfc} M.`);
    expect(result[1].displayName.endsWith(" S.")).toBe(true);
  });

  it("treats first names differing only in case as the same cohort", () => {
    const result = abbreviateNames([
      { id: "1", firstName: "Anna", lastName: "Meier" },
      { id: "2", firstName: "anna", lastName: "Schmidt" },
    ]);
    expect(result.map((r) => r.displayName)).toEqual(["Anna M.", "anna S."]);
  });

  it("compares last-name prefixes case-insensitively", () => {
    const result = abbreviateNames([
      { id: "1", firstName: "Anna", lastName: "Meier" },
      { id: "2", firstName: "Anna", lastName: "meyer" },
    ]);
    expect(result.map((r) => r.displayName)).toEqual([
      "Anna Mei.",
      "Anna mey.",
    ]);
  });

  it("numbers display names identical up to case", () => {
    const result = abbreviateNames([
      { id: "1", firstName: "Anna", lastName: "Meier" },
      { id: "2", firstName: "anna", lastName: "meier" },
    ]);
    expect(result.map((r) => r.displayName)).toEqual([
      "Anna Meier (1)",
      "anna meier (2)",
    ]);
  });
});
