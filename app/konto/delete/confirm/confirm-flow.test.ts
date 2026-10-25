import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/account", () => ({
  verifyDeletionToken: vi.fn(),
  isDeletionNonceCurrent: vi.fn(),
  deleteAccount: vi.fn(),
  findSoleAdminGroups: vi.fn(),
}));
vi.mock("@/lib/account/notify", () => ({ notifyAccountDeleted: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { confirmAccountDeletion } from "./actions";
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import {
  verifyDeletionToken,
  isDeletionNonceCurrent,
  deleteAccount,
  findSoleAdminGroups,
} from "@/lib/account";
import { notifyAccountDeleted } from "@/lib/account/notify";
import { groupTag } from "@/lib/cache-tags";

function form(token = "tok") {
  const f = new FormData();
  f.set("token", token);
  return f;
}

const DELETE_RESULT = {
  nullifiedMembershipCount: 2,
  affectedSlugs: ["familie", "buero"],
  affectedDrawnGroups: [{ groupId: "g1" }],
  affectedOpenGroups: [],
};

function mockAdmin(opts: {
  email?: string | undefined;
  profile?: { first_name: string; last_name: string } | null;
}) {
  const email = "email" in opts ? opts.email : "u1@example.com";
  const profile =
    "profile" in opts ? opts.profile : { first_name: "Max", last_name: "Muster" };
  vi.mocked(createAdminClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: { email } } }),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: profile }),
    })),
  } as never);
}

async function run(token?: string) {
  try {
    await confirmAccountDeletion(form(token));
  } catch (err) {
    return (err as Error).message;
  }
  return "no redirect";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyDeletionToken).mockReturnValue({
    valid: true,
    userId: "u1",
    nonce: "n1",
  });
  vi.mocked(getUser).mockResolvedValue(null);
  vi.mocked(isDeletionNonceCurrent).mockResolvedValue(true);
  vi.mocked(findSoleAdminGroups).mockResolvedValue([]);
  vi.mocked(deleteAccount).mockResolvedValue(DELETE_RESULT as never);
  mockAdmin({});
});

describe("confirmAccountDeletion guards", () => {
  it("rejects an invalid/expired token before any lookup", async () => {
    vi.mocked(verifyDeletionToken).mockReturnValue({ valid: false } as never);
    expect(await run("bad token")).toBe(
      "REDIRECT:/konto/delete/confirm?token=bad%20token&error=invalid",
    );
    expect(getUser).not.toHaveBeenCalled();
    expect(isDeletionNonceCurrent).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses when signed in as a different user", async () => {
    vi.mocked(getUser).mockResolvedValue({ id: "someone-else" } as never);
    expect(await run()).toContain("error=wrong_account");
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(notifyAccountDeleted).not.toHaveBeenCalled();
  });

  it("rejects a token whose nonce was already used", async () => {
    vi.mocked(isDeletionNonceCurrent).mockResolvedValue(false);
    expect(await run()).toContain("error=invalid");
    expect(isDeletionNonceCurrent).toHaveBeenCalledWith("u1", "n1");
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("blocks sole admins and deletes nothing", async () => {
    vi.mocked(findSoleAdminGroups).mockResolvedValue([
      { groupId: "g1", name: "Familie", slug: "familie" },
    ] as never);
    expect(await run()).toContain("error=sole_admin");
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("confirmAccountDeletion outcome", () => {
  it("deletes, invalidates each affected group, notifies and redirects (logged out)", async () => {
    expect(await run()).toBe("REDIRECT:/?deleted=1");
    expect(deleteAccount).toHaveBeenCalledWith("u1");
    expect(updateTag).toHaveBeenCalledTimes(2);
    expect(updateTag).toHaveBeenCalledWith(groupTag("familie"));
    expect(updateTag).toHaveBeenCalledWith(groupTag("buero"));
    expect(notifyAccountDeleted).toHaveBeenCalledWith(
      DELETE_RESULT,
      "u1@example.com",
      "Max Muster",
    );
  });

  it("also works for the matching signed-in user", async () => {
    vi.mocked(getUser).mockResolvedValue({ id: "u1" } as never);
    expect(await run()).toBe("REDIRECT:/?deleted=1");
    expect(deleteAccount).toHaveBeenCalledWith("u1");
  });

  it("falls back to the email as display name when the profile is missing", async () => {
    mockAdmin({ profile: null });
    await run();
    expect(notifyAccountDeleted).toHaveBeenCalledWith(
      DELETE_RESULT,
      "u1@example.com",
      "u1@example.com",
    );
  });

  it("captures email and name before deleteAccount removes them", async () => {
    vi.mocked(deleteAccount).mockImplementation(async () => {
      mockAdmin({ email: undefined, profile: null }); // gone after deletion
      return DELETE_RESULT as never;
    });
    await run();
    expect(notifyAccountDeleted).toHaveBeenCalledWith(
      DELETE_RESULT,
      "u1@example.com",
      "Max Muster",
    );
  });

  it("returns generic and sends no mail when deleteAccount throws", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new Error("deleteUser failed"));
    expect(await run()).toContain("error=generic");
    expect(notifyAccountDeleted).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("keeps the token in the redirect so the user can retry after a failure", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new Error("boom"));
    expect(await run("a+b/c")).toBe(
      "REDIRECT:/konto/delete/confirm?token=a%2Bb%2Fc&error=generic",
    );
  });
});
