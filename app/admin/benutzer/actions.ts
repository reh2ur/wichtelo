"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/admin/require-super-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { deleteAccount } from "@/lib/account";
import { logger } from "@/lib/logger";
import { serializeError } from "@/lib/serialize-error";
import { groupTag } from "@/lib/cache-tags";

export type BanUserState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "not_admin" | "user_not_found" | "generic" };

export async function banUser(
  _prev: BanUserState,
  formData: FormData,
): Promise<BanUserState> {
  const userId = (formData.get("userId") as string | null)?.trim() ?? "";
  if (!userId) return { status: "error", error: "generic" };
  if (!(await isSuperAdmin())) return { status: "error", error: "not_admin" };

  const admin = createAdminClient();
  const { data: userData, error: getError } =
    await admin.auth.admin.getUserById(userId);
  if (getError || !userData?.user) {
    return { status: "error", error: "user_not_found" };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });
  if (error) {
    logger
      .withMetadata({ userId, reason: error.message })
      .error("admin.ban_user_failed");
    return { status: "error", error: "generic" };
  }

  await logAdminAction("ban_user", "user", userId, {
    email: userData.user.email,
  });
  logger.withMetadata({ userId }).info("admin.user_banned");

  return { status: "success" };
}

export type UnbanUserState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "not_admin" | "user_not_found" | "generic" };

export async function unbanUser(
  _prev: UnbanUserState,
  formData: FormData,
): Promise<UnbanUserState> {
  const userId = (formData.get("userId") as string | null)?.trim() ?? "";
  if (!userId) return { status: "error", error: "generic" };
  if (!(await isSuperAdmin())) return { status: "error", error: "not_admin" };

  const admin = createAdminClient();
  const { data: userData, error: getError } =
    await admin.auth.admin.getUserById(userId);
  if (getError || !userData?.user) {
    return { status: "error", error: "user_not_found" };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (error) {
    logger
      .withMetadata({ userId, reason: error.message })
      .error("admin.unban_user_failed");
    return { status: "error", error: "generic" };
  }

  await logAdminAction("unban_user", "user", userId, {
    email: userData.user.email,
  });
  logger.withMetadata({ userId }).info("admin.user_unbanned");

  return { status: "success" };
}

export type DeleteUserState =
  | { status: "idle" }
  | { status: "error"; error: "not_admin" | "user_not_found" | "generic" };

export async function deleteUser(
  _prev: DeleteUserState,
  formData: FormData,
): Promise<DeleteUserState> {
  const userId = (formData.get("userId") as string | null)?.trim() ?? "";
  if (!userId) return { status: "error", error: "generic" };
  if (!(await isSuperAdmin())) return { status: "error", error: "not_admin" };

  const admin = createAdminClient();
  const { data: userData, error: getError } =
    await admin.auth.admin.getUserById(userId);
  if (getError || !userData?.user) {
    return { status: "error", error: "user_not_found" };
  }
  const email = userData.user.email;

  let affectedSlugs: string[];
  try {
    ({ affectedSlugs } = await deleteAccount(userId));
  } catch (err) {
    logger
      .withMetadata({ userId, error: serializeError(err) })
      .error("admin.delete_user_failed");
    return { status: "error", error: "generic" };
  }

  for (const slug of affectedSlugs) updateTag(groupTag(slug));

  await logAdminAction("delete_user", "user", userId, { email });
  logger.withMetadata({ userId }).info("admin.user_deleted");

  redirect("/admin/benutzer");
}
