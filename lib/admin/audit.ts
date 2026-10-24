import { logger } from "@/lib/logger";
import { serializeError } from "@/lib/serialize-error";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminAction =
  "ban_user" | "unban_user" | "delete_user" | "delete_group" | "reopen_group";

export type AdminTargetType = "user" | "group";

/**
 * Best-effort audit write. Runs AFTER the mutating action, so it must never
 * throw: a failed insert would surface as an error page for an action that
 * already happened. Failures are logged at error level (missing audit row =
 * actionable, grep `admin.audit_log_failed`).
 */
export async function logAdminAction(
  action: AdminAction,
  targetType: AdminTargetType,
  targetId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("admin_audit_log").insert({
      actor_email: process.env.SUPER_ADMIN_EMAIL,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata: metadata ?? null,
    });
    if (error) {
      logger
        .withMetadata({ action, targetType, targetId, reason: error.message })
        .error("admin.audit_log_failed");
    }
  } catch (err) {
    logger
      .withMetadata({
        action,
        targetType,
        targetId,
        error: serializeError(err),
      })
      .error("admin.audit_log_failed");
  }
}
