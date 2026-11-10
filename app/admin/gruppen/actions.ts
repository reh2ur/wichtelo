"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/admin/require-super-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { logger } from "@/lib/logger";
import { groupTag } from "@/lib/cache-tags";
import { notify } from "@/lib/notification";
import { getOperator } from "@/lib/operator";

interface GroupIdentity {
  name: string;
  slug: string;
  year: number;
  [key: string]: unknown;
}

async function fetchGroupIdentity(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
): Promise<GroupIdentity | null> {
  const { data, error } = await admin
    .from("groups")
    .select("name, slug, year")
    .eq("id", groupId)
    .maybeSingle();
  if (error || !data) return null;
  return data as GroupIdentity;
}

export type ReopenGroupState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "not_admin" | "group_not_found" | "generic" };

export async function reopenGroup(
  _prev: ReopenGroupState,
  formData: FormData,
): Promise<ReopenGroupState> {
  const groupId = (formData.get("groupId") as string | null)?.trim() ?? "";
  if (!groupId) return { status: "error", error: "generic" };
  if (!(await isSuperAdmin())) return { status: "error", error: "not_admin" };

  const admin = createAdminClient();
  const identity = await fetchGroupIdentity(admin, groupId);
  if (!identity) return { status: "error", error: "group_not_found" };

  // Atomic: locks group row, drops assignments + draw-mail warning, sets open.
  const { data: result, error } = await admin.rpc("reopen_group", {
    p_group_id: groupId,
  });
  if (error) {
    logger
      .withMetadata({ groupId, reason: error.message })
      .error("admin.reopen_group_failed");
    return { status: "error", error: "generic" };
  }
  if (result === "group_not_found") {
    return { status: "error", error: "group_not_found" };
  }
  if (result !== "ok" && result !== "not_drawn") {
    logger
      .withMetadata({ groupId, result })
      .error("admin.reopen_group_unexpected_result");
    return { status: "error", error: "generic" };
  }
  // not_drawn = already open (double click / race): idempotent success.

  await logAdminAction("reopen_group", "group", groupId, identity);
  logger.withMetadata({ groupId }).info("admin.group_reopened");
  updateTag(groupTag(identity.slug));

  return { status: "success" };
}

export type DeleteGroupState =
  | { status: "idle" }
  | { status: "error"; error: "not_admin" | "group_not_found" | "generic" };

export async function deleteGroup(
  _prev: DeleteGroupState,
  formData: FormData,
): Promise<DeleteGroupState> {
  const groupId = (formData.get("groupId") as string | null)?.trim() ?? "";
  if (!groupId) return { status: "error", error: "generic" };
  if (!(await isSuperAdmin())) return { status: "error", error: "not_admin" };

  const admin = createAdminClient();
  const identity = await fetchGroupIdentity(admin, groupId);
  if (!identity) return { status: "error", error: "group_not_found" };

  // Abort before deleting: without the member list nobody could be mailed.
  const { data: membersRaw, error: membersError } = await admin
    .from("memberships")
    .select("profile_id, name_snapshot")
    .eq("group_id", groupId);
  if (membersError) {
    logger
      .withMetadata({ groupId, reason: membersError.message })
      .error("admin.delete_group_members_load_failed");
    return { status: "error", error: "generic" };
  }

  const { error } = await admin.from("groups").delete().eq("id", groupId);
  if (error) {
    logger
      .withMetadata({ groupId, reason: error.message })
      .error("admin.delete_group_failed");
    return { status: "error", error: "generic" };
  }

  await logAdminAction("delete_group", "group", groupId, identity);
  logger.withMetadata({ groupId }).info("admin.group_deleted");
  updateTag(groupTag(identity.slug));

  // Members would otherwise see the group vanish unexplained (#158). The
  // operator is the contact: no group admin took this decision. Reopen sends
  // no notice (state flips back to open, nothing disappears).
  const operator = getOperator();
  const recipients = (
    await Promise.all(
      (
        (membersRaw ?? []) as {
          profile_id: string | null;
          name_snapshot: string;
        }[]
      ).map(async (m) => {
        if (!m.profile_id) return null;
        const { data: userData } = await admin.auth.admin.getUserById(
          m.profile_id,
        );
        const to = userData?.user?.email;
        return to ? { to, name: m.name_snapshot } : null;
      }),
    )
  ).filter((r): r is { to: string; name: string } => r !== null);
  if (recipients.length > 0) {
    await notify({
      type: "group.deleted",
      groupName: identity.name,
      year: identity.year,
      adminName: operator.name,
      adminEmail: operator.contactEmail,
      recipients,
    });
  }

  redirect("/admin/gruppen");
}
