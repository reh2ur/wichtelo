"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/admin/require-super-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { logger } from "@/lib/logger";
import { groupTag } from "@/lib/cache-tags";

interface GroupIdentity {
  name: string;
  slug: string;
  [key: string]: unknown;
}

async function fetchGroupIdentity(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
): Promise<GroupIdentity | null> {
  const { data, error } = await admin
    .from("groups")
    .select("name, slug")
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

  const { error } = await admin
    .from("groups")
    .update({ state: "open" })
    .eq("id", groupId);
  if (error) {
    logger
      .withMetadata({ groupId, reason: error.message })
      .error("admin.reopen_group_failed");
    return { status: "error", error: "generic" };
  }

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

  redirect("/admin/gruppen");
}
