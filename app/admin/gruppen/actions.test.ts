import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateTag } = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/admin/require-super-admin", () => ({
  isSuperAdmin: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/lib/notification", () => ({ notify }));
vi.mock("@/lib/operator", () => ({
  getOperator: () => ({ name: "Betreiber", contactEmail: "op@example.com" }),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { reopenGroup, deleteGroup } from "./actions";

type AdminClient = ReturnType<typeof createAdminClient>;

const rpc = vi.fn();

function mockAdmin() {
  rpc.mockResolvedValue({ data: "ok", error: null });
  const ok = { error: null };
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      // Thenable: awaited directly for the member list, `.maybeSingle()`
      // for the group identity.
      eq: vi.fn().mockImplementation(() =>
        Object.assign(
          Promise.resolve({
            data: [
              { profile_id: "p1", name_snapshot: "Anna" },
              { profile_id: null, name_snapshot: "Ghost" },
            ],
            error: null,
          }),
          {
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: "Familie", slug: "familie", year: 2026 },
            }),
          },
        ),
      ),
    }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(ok) }),
    delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(ok) }),
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from,
    rpc,
    auth: {
      admin: {
        getUserById: vi
          .fn()
          .mockResolvedValue({ data: { user: { email: "anna@example.com" } } }),
      },
    },
  } as unknown as AdminClient);
}

function form() {
  const fd = new FormData();
  fd.set("groupId", "g1");
  return fd;
}

describe("super-admin group actions invalidate groupTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmin();
  });

  it("reopenGroup", async () => {
    const res = await reopenGroup({ status: "idle" }, form());
    expect(res.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("reopen_group", { p_group_id: "g1" });
    expect(updateTag).toHaveBeenCalledWith("group-familie");
  });

  it("reopenGroup fails closed on rpc error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await reopenGroup({ status: "idle" }, form());
    expect(res).toEqual({ status: "error", error: "generic" });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("reopenGroup maps group_not_found and unknown results", async () => {
    rpc.mockResolvedValue({ data: "group_not_found", error: null });
    expect(await reopenGroup({ status: "idle" }, form())).toEqual({
      status: "error",
      error: "group_not_found",
    });
    rpc.mockResolvedValue({ data: "weird", error: null });
    expect(await reopenGroup({ status: "idle" }, form())).toEqual({
      status: "error",
      error: "generic",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("deleteGroup", async () => {
    await expect(deleteGroup({ status: "idle" }, form())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(updateTag).toHaveBeenCalledWith("group-familie");
  });

  it("deleteGroup notifies live members with the operator as contact", async () => {
    await expect(deleteGroup({ status: "idle" }, form())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(notify).toHaveBeenCalledWith({
      type: "group.deleted",
      groupName: "Familie",
      year: 2026,
      adminName: "Betreiber",
      adminEmail: "op@example.com",
      recipients: [{ to: "anna@example.com", name: "Anna" }],
    });
  });

  it("reopenGroup sends no notice", async () => {
    await reopenGroup({ status: "idle" }, form());
    expect(notify).not.toHaveBeenCalled();
  });
});
