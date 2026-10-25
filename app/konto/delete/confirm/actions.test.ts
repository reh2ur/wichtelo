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
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import {
  verifyDeletionToken,
  isDeletionNonceCurrent,
  deleteAccount,
  findSoleAdminGroups,
} from "@/lib/account";
import { notifyAccountDeleted } from "@/lib/account/notify";

function form() {
  const f = new FormData();
  f.set("token", "tok");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyDeletionToken).mockReturnValue({
    valid: true,
    userId: "u1",
    nonce: "n",
  });
  vi.mocked(getUser).mockResolvedValue(null);
  vi.mocked(isDeletionNonceCurrent).mockResolvedValue(true);
  vi.mocked(createAdminClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: "u1@example.com" } },
        }),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { first_name: "Max", last_name: "Muster" },
      }),
    })),
  } as never);
});

describe("confirmAccountDeletion", () => {
  it("fails closed with error=generic when the sole-admin check throws (#138)", async () => {
    vi.mocked(findSoleAdminGroups).mockRejectedValue(new Error("db down"));

    await expect(confirmAccountDeletion(form())).rejects.toThrow(
      "REDIRECT:/konto/delete/confirm?token=tok&error=generic",
    );
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(notifyAccountDeleted).not.toHaveBeenCalled();
  });

  it("still blocks sole admins", async () => {
    vi.mocked(findSoleAdminGroups).mockResolvedValue([
      { groupId: "g1", name: "Familie", slug: "familie" },
    ]);

    await expect(confirmAccountDeletion(form())).rejects.toThrow(
      "error=sole_admin",
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
