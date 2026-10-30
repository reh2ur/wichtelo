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

import { createAdminClient } from "@/lib/supabase/admin";
import { reopenGroup, deleteGroup } from "./actions";

type AdminClient = ReturnType<typeof createAdminClient>;

const rpc = vi.fn();

function mockAdmin() {
  rpc.mockResolvedValue({ data: "ok", error: null });
  const ok = { error: null };
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { name: "Familie", slug: "familie" } }),
      }),
    }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(ok) }),
    delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(ok) }),
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from,
    rpc,
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
});
