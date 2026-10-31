import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/admin/require-super-admin", () => ({
  isSuperAdmin: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/admin/session-user", () => ({
  isSelf: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/account", () => ({
  deleteAccount: vi.fn(),
  findSoleAdminGroups: vi.fn(),
}));
vi.mock("@/lib/account/notify", () => ({ notifyAccountDeleted: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { banUser, deleteUser } from "./actions";
import { isSelf } from "@/lib/admin/session-user";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAccount, findSoleAdminGroups } from "@/lib/account";
import { notifyAccountDeleted } from "@/lib/account/notify";
import { logAdminAction } from "@/lib/admin/audit";

function fd(userId: string) {
  const f = new FormData();
  f.set("userId", userId);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: "weg@example.com" } },
          error: null,
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

describe("deleteUser (super-admin, #18)", () => {
  it("blocks when the user is the sole admin and lists the groups", async () => {
    vi.mocked(findSoleAdminGroups).mockResolvedValue([
      { groupId: "g1", name: "Familie", slug: "familie" },
      { groupId: "g2", name: "Büro", slug: "buero" },
    ]);
    const res = await deleteUser({ status: "idle" }, fd("u1"));
    expect(res).toEqual({
      status: "error",
      error: "sole_admin",
      groups: ["Familie", "Büro"],
    });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(notifyAccountDeleted).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it("deletes, expires caches and sends the same notices as self-service", async () => {
    vi.mocked(findSoleAdminGroups).mockResolvedValue([]);
    const result = {
      affectedDrawnGroups: [],
      affectedOpenGroups: [],
      affectedSlugs: ["familie"],
      nullifiedMembershipCount: 1,
    };
    vi.mocked(deleteAccount).mockResolvedValue(result);

    await deleteUser({ status: "idle" }, fd("u1"));

    expect(deleteAccount).toHaveBeenCalledWith("u1");
    expect(updateTag).toHaveBeenCalledWith("group-familie");
    expect(notifyAccountDeleted).toHaveBeenCalledWith(
      result,
      "weg@example.com",
      "Max Muster",
    );
    expect(redirect).toHaveBeenCalledWith("/admin/benutzer");
  });

  it("fails closed with generic when the sole-admin check throws (#138)", async () => {
    vi.mocked(findSoleAdminGroups).mockRejectedValue(new Error("db down"));
    const res = await deleteUser({ status: "idle" }, fd("u1"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(notifyAccountDeleted).not.toHaveBeenCalled();
  });

  it("sends no notices when the deletion fails", async () => {
    vi.mocked(findSoleAdminGroups).mockResolvedValue([]);
    vi.mocked(deleteAccount).mockRejectedValue(new Error("boom"));
    const res = await deleteUser({ status: "idle" }, fd("u1"));
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(notifyAccountDeleted).not.toHaveBeenCalled();
  });
});

describe("self-targeting guard (#164)", () => {
  it("refuses to ban or delete the calling super-admin", async () => {
    vi.mocked(isSelf).mockResolvedValue(true);
    expect(await banUser({ status: "idle" }, fd("me"))).toEqual({
      status: "error",
      error: "self",
    });
    expect(await deleteUser({ status: "idle" }, fd("me"))).toEqual({
      status: "error",
      error: "self",
    });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
    vi.mocked(isSelf).mockResolvedValue(false);
  });
});
