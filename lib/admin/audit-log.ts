import type { Route } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUsersById } from "./auth-users";
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

/** Rows shown when the caller passes no explicit limit (full audit page). */
export const DEFAULT_AUDIT_LIMIT = 200;

export async function fetchAuditLog(
  limit: number = DEFAULT_AUDIT_LIMIT,
): Promise<AuditLogEntry[]> {
  const admin = createAdminClient();

  const { data: rowsRaw, error } = await admin
    .from("admin_audit_log")
    .select(
      "id, actor_email, action, target_type, target_id, metadata, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[fetchAuditLog] failed: ${error.message}`);
  const rows = (rowsRaw ?? []) as AuditLogRecord[];

  // Resolve only the targets that appear in the (bounded) rows instead of
  // listing every auth user / group on each render.
  const userIds = rows
    .filter((r) => r.target_type === "user")
    .map((r) => r.target_id);
  const groupIds = [
    ...new Set(
      rows.filter((r) => r.target_type === "group").map((r) => r.target_id),
    ),
  ];

  const [authUsers, existingGroupIds] = await Promise.all([
    getAuthUsersById(admin, userIds),
    groupIds.length === 0
      ? Promise.resolve(new Set<string>())
      : admin
          .from("groups")
          .select("id")
          .in("id", groupIds)
          .then(({ data, error: groupsError }) => {
            if (groupsError) {
              throw new Error(`[fetchAuditLog] groups: ${groupsError.message}`);
            }
            return new Set((data ?? []).map((g) => g.id as string));
          }),
  ]);
  const existingUserIds = new Set(
    [...authUsers].filter(([, u]) => u !== null).map(([id]) => id),
  );

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
