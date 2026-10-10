import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteAccount,
  issueDeletionToken,
  isDeletionNonceCurrent,
  verifyDeletionToken,
} from "./index";

type AdminClient = ReturnType<typeof createAdminClient>;

describe("deleteAccount — auth.admin.deleteUser error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws instead of silently succeeding when deleteUser returns an error", async () => {
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [] }),
      }),
    });

    const deleteUser = vi
      .fn()
      .mockResolvedValue({ error: { message: "network error" } });

    vi.mocked(createAdminClient).mockReturnValue({
      from,
      auth: { admin: { deleteUser, getUserById: vi.fn() } },
    } as unknown as AdminClient);

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
    const memberships = [
      {
        id: "m-open",
        group_id: "g-open",
        groups: { id: "g-open", name: "Offen", slug: "offen", state: "open" },
      },
      {
        id: "m-drawn",
        group_id: "g-drawn",
        groups: {
          id: "g-drawn",
          name: "Gezogen",
          slug: "gezogen",
          state: "drawn",
        },
      },
    ];
    const rpc = vi.fn().mockResolvedValue({ data: "ok", error: null });
    const from = vi.fn().mockReturnValue({
      select: vi.fn((cols: string) =>
        cols.startsWith("id, group_id")
          ? { eq: vi.fn().mockResolvedValue({ data: memberships }) }
          : {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockResolvedValue({
                    data: [{ profile_id: "admin-1" }],
                  }),
                }),
              }),
            },
      ),
    });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { email: "admin@example.com" } },
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
      rpc,
      auth: { admin: { deleteUser, getUserById } },
    } as unknown as AdminClient);

    const result = await deleteAccount("user-1");

    // Only the open group goes through the locking removal RPC.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("remove_membership", {
      p_group_id: "g-open",
      p_membership_id: "m-open",
      p_allow_drawn: false,
      p_enforce_last_admin: false,
    });
    expect(result.affectedOpenGroups.map((g) => g.slug)).toEqual(["offen"]);
    expect(result.affectedOpenGroups[0].adminEmails).toEqual([
      "admin@example.com",
    ]);
    expect(result.affectedDrawnGroups.map((g) => g.slug)).toEqual(["gezogen"]);
    expect(result.affectedSlugs).toEqual(["gezogen", "offen"]);
    // membership removal happens BEFORE the auth user is deleted (#244)
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });

  it("aborts without deleting the user when open-membership cleanup fails", async () => {
    const memberships = [
      {
        id: "m-open",
        group_id: "g-open",
        groups: { id: "g-open", name: "Offen", slug: "offen", state: "open" },
      },
    ];
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "db down" } });
    const from = vi.fn().mockReturnValue({
      select: vi.fn((cols: string) =>
        cols.startsWith("id, group_id")
          ? { eq: vi.fn().mockResolvedValue({ data: memberships }) }
          : {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockResolvedValue({ data: [] }),
                }),
              }),
            },
      ),
    });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
      rpc,
      auth: { admin: { deleteUser, getUserById: vi.fn() } },
    } as unknown as AdminClient);

    await expect(deleteAccount("user-1")).rejects.toThrow(
      "open membership cleanup failed: error",
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("aborts without deleting the user when a draw landed meanwhile (already_drawn)", async () => {
    const memberships = [
      {
        id: "m-open",
        group_id: "g-open",
        groups: { id: "g-open", name: "Offen", slug: "offen", state: "open" },
      },
    ];
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: "already_drawn", error: null });
    const from = vi.fn().mockReturnValue({
      select: vi.fn((cols: string) =>
        cols.startsWith("id, group_id")
          ? { eq: vi.fn().mockResolvedValue({ data: memberships }) }
          : {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockResolvedValue({ data: [] }),
                }),
              }),
            },
      ),
    });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
      rpc,
      auth: { admin: { deleteUser, getUserById: vi.fn() } },
    } as unknown as AdminClient);

    await expect(deleteAccount("user-1")).rejects.toThrow("already_drawn");
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
