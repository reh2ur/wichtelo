import type { DeleteAccountResult } from "@/lib/account";
import { notify } from "@/lib/notification";

/**
 * Mails after a successful account deletion, shared by the self-service
 * confirm action and the super-admin deleteUser: confirmation to the deleted
 * user (when an email is known) and a notice to the admins of every group the
 * user belonged to.
 */
export async function notifyAccountDeleted(
  result: Pick<
    DeleteAccountResult,
    "affectedDrawnGroups" | "affectedOpenGroups"
  >,
  email: string | undefined,
  name: string,
): Promise<void> {
  if (email) {
    await notify({ type: "account.deletion_confirmed", to: email, name });
  }

  for (const group of result.affectedDrawnGroups) {
    await notify({
      type: "account.deletion_admin_notice",
      groupName: group.name,
      participantName: group.participantName,
      adminEmails: group.adminEmails,
      postDraw: true,
    });
  }

  for (const group of result.affectedOpenGroups) {
    await notify({
      type: "account.deletion_admin_notice",
      groupName: group.name,
      participantName: group.participantName,
      adminEmails: group.adminEmails,
      postDraw: false,
    });
  }
}
