import { createAdminClient } from "@/lib/supabase/admin";

export type AdminAction =
  "ban_user" | "unban_user" | "delete_user" | "delete_group" | "reopen_group";

export type AdminTargetType = "user" | "group";

export async function logAdminAction(
  action: AdminAction,
  targetType: AdminTargetType,
  targetId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_log").insert({
    actor_email: process.env.SUPER_ADMIN_EMAIL,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata: metadata ?? null,
  });
  if (error) {
    throw new Error(`[logAdminAction] insert failed: ${error.message}`);
  }
}
