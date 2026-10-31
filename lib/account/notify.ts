import type { DeleteAccountResult } from "@/lib/account";
import { notify } from "@/lib/notification";
import { deferNotice } from "@/lib/notification/defer";

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

  // Admin notices are best-effort: sent after the response, in parallel.
  const notices = [
    ...result.affectedDrawnGroups.map((g) => ({ g, postDraw: true })),
    ...result.affectedOpenGroups.map((g) => ({ g, postDraw: false })),
  ];
  deferNotice(() =>
    Promise.all(
      notices.map(({ g, postDraw }) =>
        notify({
          type: "account.deletion_admin_notice",
          groupName: g.name,
          participantName: g.participantName,
          adminEmails: g.adminEmails,
          postDraw,
        }),
      ),
    ),
  );
}
