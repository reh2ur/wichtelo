import { describe, it, expect } from "vitest";
import {
  filterWishes,
  hasActiveFilter,
  parseWishFilter,
  type FilterableWish,
} from "./filter";

const wishes: FilterableWish[] = [
  { title: "Wollsocken", note: null, group_id: null, status: "open" },
  {
    title: "Buch über Äpfel",
    note: "Hardcover",
    group_id: "g1",
    status: "open",
  },
  { title: "Kerze", note: "duftet nach Zimt", group_id: "g2", status: "open" },
  { title: "Tee", note: null, group_id: "g1", status: "received" },
];

describe("parseWishFilter", () => {
  it("defaults to open view, no search, all groups", () => {
    expect(parseWishFilter({})).toEqual({ view: "open", q: "", group: "all" });
  });

  it("reads archive view, trimmed search and group", () => {
    expect(
      parseWishFilter({ status: "archiv", q: "  tee ", group: "g1" }),
    ).toEqual({ view: "received", q: "tee", group: "g1" });
  });

  it("ignores unknown status values and takes first array entry", () => {
    expect(parseWishFilter({ status: "bogus", q: ["a", "b"] })).toEqual({
      view: "open",
      q: "a",
      group: "all",
    });
  });

  it("caps search length", () => {
    expect(parseWishFilter({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("filterWishes", () => {
  const base = { view: "open", q: "", group: "all" } as const;

  it("shows only open wishes by default and only received in archive", () => {
    expect(filterWishes(wishes, base).map((w) => w.title)).toEqual([
      "Wollsocken",
      "Buch über Äpfel",
      "Kerze",
    ]);
    expect(
      filterWishes(wishes, { ...base, view: "received" }).map((w) => w.title),
    ).toEqual(["Tee"]);
  });

  it("searches title and note case-insensitively (umlauts)", () => {
    expect(
      filterWishes(wishes, { ...base, q: "ÄPFEL" }).map((w) => w.title),
    ).toEqual(["Buch über Äpfel"]);
    expect(
      filterWishes(wishes, { ...base, q: "zimt" }).map((w) => w.title),
    ).toEqual(["Kerze"]);
  });

  it("filters by group and by unassigned", () => {
    expect(
      filterWishes(wishes, { ...base, group: "g1" }).map((w) => w.title),
    ).toEqual(["Buch über Äpfel"]);
    expect(
      filterWishes(wishes, { ...base, group: "none" }).map((w) => w.title),
    ).toEqual(["Wollsocken"]);
  });

  it("combines search and group", () => {
    expect(filterWishes(wishes, { ...base, q: "kerze", group: "g1" })).toEqual(
      [],
    );
  });
});

describe("hasActiveFilter", () => {
  it("ignores the view, reacts to search/group", () => {
    expect(hasActiveFilter({ view: "received", q: "", group: "all" })).toBe(
      false,
    );
    expect(hasActiveFilter({ view: "open", q: "x", group: "all" })).toBe(true);
    expect(hasActiveFilter({ view: "open", q: "", group: "none" })).toBe(true);
  });
});
