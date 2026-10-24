import { describe, it, expect, vi, beforeEach } from "vitest";

const { insert, createAdminClient, logError, withMetadata } = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => ({ insert }));
  const logError = vi.fn();
  return {
    insert,
    createAdminClient: vi.fn(() => ({ from })),
    logError,
    withMetadata: vi.fn(() => ({ error: logError })),
  };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/logger", () => ({ logger: { withMetadata } }));

import { logAdminAction } from "./audit";

describe("logAdminAction failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw and logs an error when the insert returns an error", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });

    await expect(
      logAdminAction("delete_group", "group", "g-1", { slug: "x" }),
    ).resolves.toBeUndefined();

    expect(withMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delete_group",
        targetId: "g-1",
        reason: "boom",
      }),
    );
    expect(logError).toHaveBeenCalledWith("admin.audit_log_failed");
  });

  it("does not throw and logs an error when the client throws", async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("no service role key");
    });

    await expect(
      logAdminAction("ban_user", "user", "u-1"),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith("admin.audit_log_failed");
  });

  it("does not log on success", async () => {
    insert.mockResolvedValue({ error: null });

    await logAdminAction("unban_user", "user", "u-1");

    expect(insert).toHaveBeenCalledOnce();
    expect(logError).not.toHaveBeenCalled();
  });
});
