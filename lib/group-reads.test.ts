import { describe, it, expect, vi } from "vitest";
import {
  groupNeedsRedraw,
  liveMembersWithoutAssignment,
  loadExclusions,
  loadMembershipsWithGroups,
  loadMyReceiverId,
  loadReceiverNamesByGroup,
  loadSettingsMemberships,
} from "./group-reads";

/** Thenable query builder resolving to `result` anywhere in the chain. */
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"])
    q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}

const dbError = { data: null, error: { message: "db down" } };

function client(tables: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => query(tables[table] ?? dbError)),
  } as never;
}

describe("page read helpers throw on DB errors (#139)", () => {
  it("loadMembershipsWithGroups: error is not an empty list", async () => {
    await expect(
      loadMembershipsWithGroups(client({ memberships: dbError }), "u1"),
    ).rejects.toThrow("db down");
  });

  it("loadMembershipsWithGroups returns rows on success", async () => {
    const rows = [{ id: "m1", role: "admin", group_id: "g1", groups: {} }];
    await expect(
      loadMembershipsWithGroups(
        client({ memberships: { data: rows, error: null } }),
        "u1",
      ),
    ).resolves.toEqual(rows);
  });

  it("loadReceiverNamesByGroup: assignments error throws", async () => {
    await expect(
      loadReceiverNamesByGroup(client({ assignments: dbError }), client({}), [
        "m1",
      ]),
    ).rejects.toThrow("db down");
  });

  it("loadReceiverNamesByGroup: memberships error throws", async () => {
    const supabase = client({
      assignments: {
        data: [{ group_id: "g1", receiver_id: "m2" }],
        error: null,
      },
    });
    await expect(
      loadReceiverNamesByGroup(supabase, client({ memberships: dbError }), [
        "m1",
      ]),
    ).rejects.toThrow("db down");
  });

  it("loadMyReceiverId: assignment error throws instead of 'no assignment'", async () => {
    await expect(
      loadMyReceiverId(client({ assignments: dbError }), "g1", "m1"),
    ).rejects.toThrow("db down");
  });

  it("loadMyReceiverId: no row is null, a row is its receiver id", async () => {
    await expect(
      loadMyReceiverId(
        client({ assignments: { data: null, error: null } }),
        "g1",
        "m1",
      ),
    ).resolves.toBeNull();
    await expect(
      loadMyReceiverId(
        client({ assignments: { data: { receiver_id: "m2" }, error: null } }),
        "g1",
        "m1",
      ),
    ).resolves.toBe("m2");
  });

  it("loadSettingsMemberships / loadExclusions throw on error", async () => {
    await expect(
      loadSettingsMemberships(client({ memberships: dbError }), "g1"),
    ).rejects.toThrow("db down");
    await expect(
      loadExclusions(client({ exclusions: dbError }), "g1"),
    ).rejects.toThrow("db down");
  });
});

describe("liveMembersWithoutAssignment (#141)", () => {
  const members = [
    { id: "a", profile_id: "pa" },
    { id: "b", profile_id: "pb" },
    { id: "ghost", profile_id: null },
  ];

  it("is empty when every live member gives to someone", () => {
    expect(liveMembersWithoutAssignment(members, ["a", "b"])).toEqual([]);
  });

  it("lists live members whose outgoing row is gone", () => {
    expect(liveMembersWithoutAssignment(members, ["b", "ghost"])).toEqual([
      "a",
    ]);
  });

  it("ignores ghosts (account deleted, assignments intact)", () => {
    expect(liveMembersWithoutAssignment(members, ["a", "b"])).toEqual([]);
    expect(liveMembersWithoutAssignment(members, [])).toEqual(["a", "b"]);
  });
});

describe("groupNeedsRedraw (#141)", () => {
  const members = {
    data: [
      { id: "a", profile_id: "pa" },
      { id: "b", profile_id: "pb" },
      { id: "c", profile_id: "pc" },
    ],
    error: null,
  };

  it("is false for an intact draw", async () => {
    const admin = client({
      memberships: members,
      assignments: {
        data: [{ giver_id: "a" }, { giver_id: "b" }, { giver_id: "c" }],
        error: null,
      },
    });
    await expect(groupNeedsRedraw(admin, "g1")).resolves.toBe(false);
  });

  it("is true once a member lost their assignment", async () => {
    const admin = client({
      memberships: members,
      assignments: {
        data: [{ giver_id: "b" }, { giver_id: "c" }],
        error: null,
      },
    });
    await expect(groupNeedsRedraw(admin, "g1")).resolves.toBe(true);
  });

  it("throws on DB errors", async () => {
    await expect(
      groupNeedsRedraw(
        client({ memberships: members, assignments: dbError }),
        "g1",
      ),
    ).rejects.toThrow("db down");
  });
});
