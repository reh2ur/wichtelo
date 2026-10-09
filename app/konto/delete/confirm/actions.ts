"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import {
  verifyDeletionToken,
  isDeletionNonceCurrent,
  deleteAccount,
  findSoleAdminGroups,
} from "@/lib/account";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notification";
import { logger } from "@/lib/logger";
import { serializeError } from "@/lib/serialize-error";
import { groupTag } from "@/lib/cache-tags";

export type ConfirmDeletionError =
  "invalid" | "wrong_account" | "sole_admin" | "generic";

/**
 * POST target of the confirmation page. Authenticated by the emailed HMAC
 * token (works logged out); refuses a session of a different user. Always
 * redirects — success to `/?deleted=1`, failure back to the page with `error`.
 */
export async function confirmAccountDeletion(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = (error: ConfirmDeletionError): never =>
    redirect(
      `/konto/delete/confirm?token=${encodeURIComponent(token)}&error=${error}`,
    );

  const result = verifyDeletionToken(token);
  if (!result.valid) return back("invalid");
  const { userId, nonce } = result;

  const sessionUser = await getUser();
  if (sessionUser && sessionUser.id !== userId) return back("wrong_account");

  if (!(await isDeletionNonceCurrent(userId, nonce))) return back("invalid");

  // Capture email/name before deletion — deleteAccount() removes the auth
  // user, which cascade-deletes the profile row.
  const admin = createAdminClient();
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .single();
  const email = userData?.user?.email;
  const name = profile
    ? `${profile.first_name} ${profile.last_name}`
    : (email ?? "");

  if ((await findSoleAdminGroups(userId)).length > 0) return back("sole_admin");

  let deleteResult;
  try {
    deleteResult = await deleteAccount(userId);
  } catch (err) {
    logger
      .withMetadata({ userId, error: serializeError(err) })
      .error("account.deletion_failed");
    return back("generic");
  }

  logger
    .withMetadata({
      userId,
      nullifiedMembershipCount: deleteResult.nullifiedMembershipCount,
    })
    .info("membership.nulled");

  for (const slug of deleteResult.affectedSlugs) updateTag(groupTag(slug));

  if (email) {
    await notify({ type: "account.deletion_confirmed", to: email, name });
  }

  for (const group of deleteResult.affectedDrawnGroups) {
    await notify({
      type: "account.deletion_admin_notice",
      groupName: group.name,
      adminEmails: group.adminEmails,
      postDraw: true,
    });
  }

  for (const group of deleteResult.affectedOpenGroups) {
    await notify({
      type: "account.deletion_admin_notice",
      groupName: group.name,
      adminEmails: group.adminEmails,
      postDraw: false,
    });
  }

  logger
    .withMetadata({
      userId,
      affectedDrawnGroups: deleteResult.affectedDrawnGroups.length,
    })
    .info("account.deleted");

  redirect("/?deleted=1");
}
