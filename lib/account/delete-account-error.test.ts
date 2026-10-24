import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteAccount,
  findSoleAdminGroups,
  issueDeletionToken,
  isDeletionNonceCurrent,
  verifyDeletionToken,
} from "./index";

type AdminClient = ReturnType<typeof createAdminClient>;

interface Group {
  id: string;
  name: string;
  slug: string;
  state: "open" | "drawn";
}

interface FakeOptions {
  /** Groups the user belongs to; removed/ghosted by the RPC fakes. */
  groups: Group[];
  /** Admin profile ids returned for every group's admin lookup. */
  adminProfileIds?: string[];
  membershipsError?: { message: string };
  adminLookupError?: { message: string };
  /** remove_membership result per group id (default "ok"). */
  removeResult?: Record<string, string>;
  ghostError?: { message: string };
  /** Number of deleteUser calls that fail before one succeeds. */
  deleteUserFailures?: number;
  /** Persisted auth user app_metadata (survives across deleteAccount calls). */
  appMetadata?: Record<string, unknown>;
}

/** In-memory stand-in for the service-role client around deleteAccount. */
function fakeAdmin(opts: FakeOptions) {
  const live = [...opts.groups];
  const appMetadata: Record<string, unknown> = { ...opts.appMetadata };
  let deleteFailures = opts.deleteUserFailures ?? 0;

  const rows = () =>
    live.map((g) => ({
      id: `m-${g.id}`,
      group_id: g.id,
      name_snapshot: `Name in ${g.name}`,
      groups: g,
    }));

  const from = vi.fn((table: string) => ({
    select: vi.fn((cols: string) => {
      if (table === "groups") {
        return {
          in: vi.fn((_col: string, ids: string[]) =>
            Promise.resolve({
              data: opts.groups
                .filter((g) => ids.includes(g.id))
                .map(({ id, name, slug }) => ({ id, name, slug })),
              error: null,
            }),
          ),
        };
      }
      if (cols.startsWith("id, group_id")) {
        return {
          eq: vi
            .fn()
            .mockResolvedValue(
              opts.membershipsError
                ? { data: null, error: opts.membershipsError }
                : { data: rows(), error: null },
            ),
        };
      }
      return {
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue(
              opts.adminLookupError
                ? { data: null, error: opts.adminLookupError }
                : {
                    data: (opts.adminProfileIds ?? []).map((id) => ({
                      profile_id: id,
                    })),
                    error: null,
                  },
            ),
          }),
        }),
      };
    }),
  }));

  const rpc = vi.fn(async (fn: string, args: Record<string, string>) => {
    if (fn === "remove_membership") {
      const result = opts.removeResult?.[args.p_group_id] ?? "ok";
      if (result === "ok") {
        const i = live.findIndex((g) => g.id === args.p_group_id);
        if (i >= 0) live.splice(i, 1);
      }
      return { data: result, error: null };
    }
    // ghost_drawn_memberships: ghosted rows no longer match profile_id = user
    if (opts.ghostError) return { data: null, error: opts.ghostError };
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].state === "drawn") live.splice(i, 1);
    }
    return { data: 1, error: null };
  });

  const deleteUser = vi.fn(async () =>
    deleteFailures-- > 0
      ? { error: { message: "network error" } }
      : { error: null },
  );
  const getUserById = vi.fn(async (id: string) => ({
    data: {
      user: {
        id,
        email: `${id}@example.com`,
        app_metadata: { ...appMetadata },
      },
    },
    error: null,
  }));
  const updateUserById = vi.fn(
    async (_id: string, attrs: { app_metadata: Record<string, unknown> }) => {
      Object.assign(appMetadata, attrs.app_metadata);
      return { error: null };
    },
  );

  vi.mocked(createAdminClient).mockReturnValue({
    from,
    rpc,
    auth: { admin: { deleteUser, getUserById, updateUserById } },
  } as unknown as AdminClient);
  return { rpc, deleteUser, getUserById, updateUserById, appMetadata };
}

const open1: Group = { id: "g-1", name: "Eins", slug: "eins", state: "open" };
const open2: Group = { id: "g-2", name: "Zwei", slug: "zwei", state: "open" };
const drawn: Group = {
  id: "g-d",
  name: "Gezogen",
  slug: "gezogen",
  state: "drawn",
};

describe("deleteAccount - auth.admin.deleteUser error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws instead of silently succeeding when deleteUser returns an error", async () => {
    const { deleteUser } = fakeAdmin({ groups: [], deleteUserFailures: 1 });

    await expect(deleteAccount("user-1")).rejects.toEqual({
      message: "network error",
    });
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });
});

describe("deletion nonce (single-use token)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issueDeletionToken stores nonce on the user and embeds it in the token", async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { updateUserById } },
    } as unknown as AdminClient);

    const token = await issueDeletionToken("user-1");
    const verified = verifyDeletionToken(token);
    expect(verified.valid).toBe(true);
    const stored = updateUserById.mock.calls[0][1].app_metadata.deletion_nonce;
    if (verified.valid) expect(verified.nonce).toBe(stored);
  });

  it("isDeletionNonceCurrent accepts only the stored nonce", async () => {
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { app_metadata: { deletion_nonce: "abc" } } },
    });
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { getUserById } },
    } as unknown as AdminClient);

    expect(await isDeletionNonceCurrent("u", "abc")).toBe(true);
    expect(await isDeletionNonceCurrent("u", "abd")).toBe(false);
    expect(await isDeletionNonceCurrent("u", "abcd")).toBe(false);
  });

  it("isDeletionNonceCurrent is false once the user is gone", async () => {
    const getUserById = vi.fn().mockResolvedValue({ data: { user: null } });
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { getUserById } },
    } as unknown as AdminClient);
    expect(await isDeletionNonceCurrent("u", "abc")).toBe(false);
  });
});

describe("deleteAccount - open vs drawn groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes open-group memberships, keeps drawn ones, notifies admins of both", async () => {
    const { rpc, deleteUser } = fakeAdmin({
      groups: [open1, drawn],
      adminProfileIds: ["admin-1"],
    });

    const result = await deleteAccount("user-1");

    // Open group: locking removal RPC. Drawn groups: ghosting RPC (#105).
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "remove_membership", {
      p_group_id: "g-1",
      p_membership_id: "m-g-1",
      p_allow_drawn: false,
      p_enforce_last_admin: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ghost_drawn_memberships", {
      p_profile_id: "user-1",
    });
    expect(result.affectedOpenGroups.map((g) => g.slug)).toEqual(["eins"]);
    expect(result.affectedOpenGroups[0].adminEmails).toEqual([
      "admin-1@example.com",
    ]);
    expect(result.affectedDrawnGroups.map((g) => g.slug)).toEqual(["gezogen"]);
    expect(result.affectedSlugs).toEqual(["gezogen", "eins"]);
    // membership removal happens BEFORE the auth user is deleted (#244)
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });

  it("aborts without deleting the user when open-membership cleanup fails", async () => {
    const { deleteUser } = fakeAdmin({
      groups: [open1],
      removeResult: { "g-1": "error" },
    });

    await expect(deleteAccount("user-1")).rejects.toThrow(
      "open membership cleanup failed: error",
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("aborts without deleting the user when a draw landed meanwhile (already_drawn)", async () => {
    const { deleteUser } = fakeAdmin({
      groups: [open1],
      removeResult: { "g-1": "already_drawn" },
    });

    await expect(deleteAccount("user-1")).rejects.toThrow("already_drawn");
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("aborts without deleting the user when drawn-membership ghosting fails (#105)", async () => {
    const { deleteUser } = fakeAdmin({
      groups: [drawn],
      ghostError: { message: "db down" },
    });

    await expect(deleteAccount("user-1")).rejects.toThrow(
      "drawn membership cleanup failed: db down",
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("deleteAccount - retry after partial failure (#137)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deleteUser fails once: retry still reports drawn and open groups", async () => {
    const { deleteUser } = fakeAdmin({
      groups: [open1, drawn],
      adminProfileIds: ["admin-1"],
      deleteUserFailures: 1,
    });

    await expect(deleteAccount("user-1")).rejects.toEqual({
      message: "network error",
    });
    // Memberships are gone/ghosted now; the retry must not forget them.
    const result = await deleteAccount("user-1");

    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(result.affectedDrawnGroups).toMatchObject([
      {
        slug: "gezogen",
        name: "Gezogen",
        participantName: "Name in Gezogen",
        adminEmails: ["admin-1@example.com"],
      },
    ]);
    expect(result.affectedOpenGroups).toMatchObject([
      { slug: "eins", name: "Eins", participantName: "Name in Eins" },
    ]);
    expect([...result.affectedSlugs].sort()).toEqual(["eins", "gezogen"]);
  });

  it("failure at the 2nd open group still yields the 1st on retry", async () => {
    const removeResult: Record<string, string> = { "g-2": "error" };
    const { rpc } = fakeAdmin({
      groups: [open1, open2],
      adminProfileIds: ["admin-1"],
      removeResult,
    });

    await expect(deleteAccount("user-1")).rejects.toThrow(
      "open membership cleanup failed: error",
    );
    delete removeResult["g-2"];
    const result = await deleteAccount("user-1");

    // Attempt 1: g-1 ok + g-2 fails. Retry: only g-2 is still a membership.
    expect(
      rpc.mock.calls.filter(([fn]) => fn === "remove_membership"),
    ).toHaveLength(3);
    expect(result.affectedOpenGroups.map((g) => g.slug).sort()).toEqual([
      "eins",
      "zwei",
    ]);
  });

  it("persists the affected groups before the first mutation", async () => {
    const { rpc, updateUserById } = fakeAdmin({ groups: [open1, drawn] });

    await deleteAccount("user-1");

    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0],
    );
    const stored = updateUserById.mock.calls[0][1].app_metadata
      .pending_deletion as { groupId: string }[];
    expect(stored.map((e) => e.groupId).sort()).toEqual(["g-1", "g-d"]);
  });

  it("does not report a group twice when the user re-joined it", async () => {
    fakeAdmin({
      groups: [open1],
      appMetadata: {
        pending_deletion: [
          { groupId: "g-1", state: "open", participantName: "Alt" },
        ],
      },
    });

    const result = await deleteAccount("user-1");

    expect(result.affectedOpenGroups).toHaveLength(1);
    expect(result.affectedOpenGroups[0].participantName).toBe("Name in Eins");
  });
});

describe("DB read errors fail closed (#138)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deleteAccount rejects and never touches the user when the memberships read fails", async () => {
    const { deleteUser, rpc } = fakeAdmin({
      groups: [open1, drawn],
      membershipsError: { message: "db down" },
    });

    await expect(deleteAccount("user-1")).rejects.toEqual({
      message: "db down",
    });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("deleteAccount rejects before any mutation when the admin lookup fails", async () => {
    const { deleteUser, rpc, updateUserById } = fakeAdmin({
      groups: [open1],
      adminLookupError: { message: "admin lookup failed" },
    });

    await expect(deleteAccount("user-1")).rejects.toEqual({
      message: "admin lookup failed",
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("findSoleAdminGroups rejects when the own-admin-memberships query fails", async () => {
    const select = vi.fn().mockReturnValue({
      eq: () => ({
        eq: () =>
          Promise.resolve({ data: null, error: { message: "db down" } }),
      }),
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({ select }),
    } as unknown as AdminClient);

    await expect(findSoleAdminGroups("user-1")).rejects.toEqual({
      message: "db down",
    });
  });

  it("findSoleAdminGroups rejects when the other-admins query fails", async () => {
    const own = {
      data: [{ group_id: "g-1", groups: { id: "g-1", name: "A", slug: "a" } }],
      error: null,
    };
    const select = vi
      .fn()
      .mockReturnValueOnce({
        eq: () => ({ eq: () => Promise.resolve(own) }),
      })
      .mockReturnValueOnce({
        eq: () => ({
          eq: () => ({
            not: () => ({
              neq: () =>
                Promise.resolve({ data: null, error: { message: "db down" } }),
            }),
          }),
        }),
      });
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => ({ select }),
    } as unknown as AdminClient);

    await expect(findSoleAdminGroups("user-1")).rejects.toEqual({
      message: "db down",
    });
  });
});
