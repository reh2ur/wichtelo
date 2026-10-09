/**
 * @integration
 *
 * Integration test for admin audit module.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, afterEach } from "vitest";
import { logAdminAction } from "./audit";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("logAdminAction", () => {
  const insertedIds: string[] = [];

  afterEach(async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    if (insertedIds.length) {
      await admin.from("admin_audit_log").delete().in("id", insertedIds);
      insertedIds.length = 0;
    }
  });

  it("writes a row to admin_audit_log via service role client", async () => {
    process.env.SUPER_ADMIN_EMAIL = "super-admin@test.local";

    const targetId = "550e8400-e29b-41d4-a716-446655440000";
    await logAdminAction("ban_user", "user", targetId, { reason: "spam" });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data } = await admin
      .from("admin_audit_log")
      .select("*")
      .eq("target_id", targetId)
      .order("created_at", { ascending: false })
      .limit(1);

    expect(data).toHaveLength(1);
    expect(data![0].actor_email).toBe("super-admin@test.local");
    expect(data![0].action).toBe("ban_user");
    expect(data![0].target_type).toBe("user");
    expect(data![0].metadata).toEqual({ reason: "spam" });

    insertedIds.push(data![0].id);
  });
});
