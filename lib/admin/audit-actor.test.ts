import { describe, it, expect, vi, beforeEach } from "vitest";

const { insert, getSessionUser } = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue({ error: null }),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert }) }),
}));
vi.mock("@/lib/admin/session-user", () => ({ getSessionUser }));

import { logAdminAction } from "./audit";

describe("logAdminAction actor (#164)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPER_ADMIN_EMAIL = "env@example.com";
  });

  it("uses the session user's email, not SUPER_ADMIN_EMAIL", async () => {
    getSessionUser.mockResolvedValue({ id: "u", email: "session@example.com" });
    await logAdminAction("ban_user", "user", "t");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_email: "session@example.com" }),
    );
  });

  it("falls back to env when there is no request session", async () => {
    getSessionUser.mockRejectedValue(new Error("outside request scope"));
    await logAdminAction("ban_user", "user", "t");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_email: "env@example.com" }),
    );
  });
});
