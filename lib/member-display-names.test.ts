import { describe, it, expect } from "vitest";
import {
  buildDisplayNameMap,
  loadMemberDisplayNames,
} from "@/lib/member-display-names";

type Admin = Parameters<typeof loadMemberDisplayNames>[0];

function adminWith(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const calls: string[][] = [];
  const admin = {
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => {
          calls.push(ids);
          return result;
        },
      }),
    }),
  } as unknown as Admin;
  return { admin, calls };
}

const members = [
  { id: "m1", name_snapshot: "Anna Müller", profile_id: "p1" },
  { id: "m2", name_snapshot: "Anna Meier", profile_id: null },
  { id: "m3", name_snapshot: "Ben Klein", profile_id: null },
];

describe("buildDisplayNameMap", () => {
  it("abbreviates colliding first names only", () => {
    const map = buildDisplayNameMap(
      members,
      new Map([["p1", { first_name: "Anna", last_name: "Müller" }]]),
    );
    expect(map.get("m3")).toBe("Ben");
    expect(map.get("m1")).not.toBe(map.get("m2"));
  });
});

describe("loadMemberDisplayNames", () => {
  it("loads profiles of linked members and returns names", async () => {
    const { admin, calls } = adminWith({
      data: [{ id: "p1", first_name: "Anna", last_name: "Müller" }],
      error: null,
    });
    const map = await loadMemberDisplayNames(admin, members);
    expect(calls).toEqual([["p1"]]);
    expect(map.get("m3")).toBe("Ben");
  });

  it("throws on DB error instead of falling back silently", async () => {
    const { admin } = adminWith({ data: null, error: { message: "boom" } });
    await expect(loadMemberDisplayNames(admin, members)).rejects.toThrow(
      /boom/,
    );
  });

  it("skips the query when nobody has a profile", async () => {
    const { admin, calls } = adminWith({ data: [], error: null });
    await loadMemberDisplayNames(admin, [members[1]]);
    expect(calls).toEqual([]);
  });
});
