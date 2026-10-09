import type { Route } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllAuthUsers } from "./auth-users";
import type { AdminAction, AdminTargetType } from "./audit";

export interface AuditLogEntry {
  id: string;
  actorEmail: string;
  action: AdminAction;
  targetType: AdminTargetType;
  targetId: string;
  targetExists: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditLogRecord {
  id: string;
  actor_email: string;
  action: AdminAction;
  target_type: AdminTargetType;
  target_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchAuditLog(limit?: number): Promise<AuditLogEntry[]> {
  const admin = createAdminClient();

  let query = admin
    .from("admin_audit_log")
    .select(
      "id, actor_email, action, target_type, target_id, metadata, created_at",
    )
    .order("created_at", { ascending: false });
  if (limit) query = query.limit(limit);

  const { data: rowsRaw } = await query;
  const rows = (rowsRaw ?? []) as AuditLogRecord[];

  const hasUserTargets = rows.some((r) => r.target_type === "user");
  const hasGroupTargets = rows.some((r) => r.target_type === "group");

  let existingUserIds = new Set<string>();
  if (hasUserTargets) {
    const authUsers = await listAllAuthUsers(admin);
    existingUserIds = new Set(authUsers.map((u) => u.id));
  }

  let existingGroupIds = new Set<string>();
  if (hasGroupTargets) {
    const { data: groupsRaw } = await admin.from("groups").select("id");
    existingGroupIds = new Set(
      ((groupsRaw ?? []) as { id: string }[]).map((g) => g.id),
    );
  }

  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    targetExists:
      r.target_type === "user"
        ? existingUserIds.has(r.target_id)
        : existingGroupIds.has(r.target_id),
    metadata: r.metadata,
    createdAt: r.created_at,
  }));
}

export function resolveTargetHref(
  entry: Pick<AuditLogEntry, "targetType" | "targetId" | "targetExists">,
): Route | null {
  if (!entry.targetExists) return null;
  return (
    entry.targetType === "user"
      ? `/admin/benutzer/${entry.targetId}`
      : `/admin/gruppen/${entry.targetId}`
  ) as Route;
}
