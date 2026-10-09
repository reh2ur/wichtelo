import type { ReactElement } from "react";
import { resend, FROM_EMAIL } from "@/lib/email";
import { logger } from "@/lib/logger";
import { serializeError } from "@/lib/serialize-error";
import { DrawAssignmentEmail } from "@/emails/draw-assignment";
import { GroupDeletedEmail } from "@/emails/group-deleted";
import { ParticipantJoinedEmail } from "@/emails/participant-joined";
import { ParticipantLeftConfirmationEmail } from "@/emails/participant-left-confirmation";
import { ParticipantLeftAdminNoticeEmail } from "@/emails/participant-left-admin-notice";
import { AccountDeletionEmail } from "@/emails/account-deletion";
import { AccountDeletionConfirmedEmail } from "@/emails/account-deletion-confirmed";
import { AccountDeletionAdminNoticeEmail } from "@/emails/account-deletion-admin-notice";

export interface DrawAssignmentRecipient {
  to: string;
  giverName: string;
  receiverDisplayName: string;
}

export interface GroupDeletedRecipient {
  to: string;
  name: string;
}

export type DomainEvent =
  | {
      type: "draw.completed" | "draw.redrawn";
      groupName: string;
      groupSlug: string;
      year: number;
      adminName: string | null;
      adminEmail: string | null;
      assignments: DrawAssignmentRecipient[];
      /** Scopes Resend idempotency keys so retries never duplicate mails. */
      groupId: string;
      /** Unique per draw (e.g. pre-draw `draw_version`). */
      drawKey: string;
    }
  | {
      type: "group.deleted";
      groupName: string;
      year: number;
      adminName: string | null;
      adminEmail: string | null;
      recipients: GroupDeletedRecipient[];
    }
  | {
      type: "participant.joined";
      groupName: string;
      participantName: string;
      adminEmails: string[];
    }
  | {
      type: "participant.left";
      groupName: string;
      participantName: string;
      participantEmail: string;
      postDraw: boolean;
      adminEmails: string[];
    }
  | {
      type: "account.deletion_requested";
      to: string;
      confirmUrl: string;
    }
  | {
      type: "account.deletion_confirmed";
      to: string;
      name: string;
    }
  | {
      type: "account.deletion_admin_notice";
      groupName: string;
      adminEmails: string[];
      /** true: group already drawn (re-draw may be needed). false: open group, member removed. */
      postDraw: boolean;
    };

/** Resend batch endpoint accepts at most 100 emails per call. */
export const BATCH_LIMIT = 100;

export interface NotifyResult {
  /** Emails accepted by Resend. */
  sent: number;
  /** Emails that could not be handed to Resend. */
  failed: number;
}

interface EmailPayload {
  to: string | string[];
  subject: string;
  react: ReactElement;
}

function buildPayloads(event: DomainEvent): EmailPayload[] {
  switch (event.type) {
    case "draw.completed":
    case "draw.redrawn": {
      const isRedraw = event.type === "draw.redrawn";
      return event.assignments.map((a) => ({
        to: a.to,
        subject: isRedraw
          ? `Wichtelo ${event.groupName}: Neue Auslosung`
          : `Wichtelo ${event.groupName}: Du bist dran!`,
        react: (
          <DrawAssignmentEmail
            groupName={event.groupName}
            groupSlug={event.groupSlug}
            year={event.year}
            giverName={a.giverName}
            receiverDisplayName={a.receiverDisplayName}
            adminName={event.adminName}
            adminEmail={event.adminEmail}
            isRedraw={isRedraw}
          />
        ),
      }));
    }

    case "group.deleted":
      return event.recipients.map((r) => ({
        to: r.to,
        subject: `Wichtelo ${event.groupName} wurde gelöscht`,
        react: (
          <GroupDeletedEmail
            groupName={event.groupName}
            year={event.year}
            recipientName={r.name}
            adminName={event.adminName}
            adminEmail={event.adminEmail}
          />
        ),
      }));

    case "participant.joined":
      if (event.adminEmails.length === 0) return [];
      return [
        {
          to: event.adminEmails,
          subject: `Wichtelo ${event.groupName}: Neuer Teilnehmer beigetreten`,
          react: (
            <ParticipantJoinedEmail
              groupName={event.groupName}
              participantName={event.participantName}
            />
          ),
        },
      ];

    case "participant.left": {
      const payloads: EmailPayload[] = [
        {
          to: event.participantEmail,
          subject: `Wichtelo ${event.groupName}: Du hast die Gruppe verlassen`,
          react: (
            <ParticipantLeftConfirmationEmail groupName={event.groupName} />
          ),
        },
      ];
      if (event.adminEmails.length > 0) {
        payloads.push({
          to: event.adminEmails,
          subject: `Wichtelo ${event.groupName}: Teilnehmer hat die Gruppe verlassen`,
          react: (
            <ParticipantLeftAdminNoticeEmail
              groupName={event.groupName}
              participantName={event.participantName}
              postDraw={event.postDraw}
            />
          ),
        });
      }
      return payloads;
    }

    case "account.deletion_requested":
      return [
        {
          to: event.to,
          subject: "Konto löschen – Bestätigung erforderlich",
          react: <AccountDeletionEmail confirmUrl={event.confirmUrl} />,
        },
      ];

    case "account.deletion_confirmed":
      return [
        {
          to: event.to,
          subject: "Konto gelöscht – Bestätigung",
          react: <AccountDeletionConfirmedEmail name={event.name} />,
        },
      ];

    case "account.deletion_admin_notice":
      if (event.adminEmails.length === 0) return [];
      return [
        {
          to: event.adminEmails,
          subject: `Wichtelo: Teilnehmer hat Konto gelöscht – ${event.groupName}`,
          react: (
            <AccountDeletionAdminNoticeEmail
              groupName={event.groupName}
              postDraw={event.postDraw}
            />
          ),
        },
      ];
  }
}

function idempotencyBase(event: DomainEvent): string | null {
  if (event.type === "draw.completed" || event.type === "draw.redrawn") {
    return `${event.type}:${event.groupId}:${event.drawKey}`;
  }
  return null;
}

/**
 * Single entry point for all transactional email. Maps a domain event to its
 * React Email template(s) and recipient list, then dispatches via Resend in
 * chunks of at most 100 (batch limit). Draw events carry an idempotency key
 * per chunk. Never throws — delivery failures are logged and reported via the
 * returned counts (a failed chunk counts all its emails as failed), so a
 * failed email never blocks the mutation that triggered it.
 */
export async function notify(event: DomainEvent): Promise<NotifyResult> {
  const payloads = buildPayloads(event);
  const result: NotifyResult = { sent: 0, failed: 0 };
  if (payloads.length === 0) return result;

  const base = idempotencyBase(event);

  for (let i = 0; i < payloads.length; i += BATCH_LIMIT) {
    const chunk = payloads.slice(i, i + BATCH_LIMIT);
    const options = base
      ? { idempotencyKey: `${base}:${i / BATCH_LIMIT}` }
      : undefined;
    try {
      if (chunk.length === 1) {
        const { error } = await resend.emails.send(
          { from: FROM_EMAIL, ...chunk[0] },
          options,
        );
        if (error) throw new Error(error.message);
      } else {
        const { error } = await resend.batch.send(
          chunk.map((payload) => ({ from: FROM_EMAIL, ...payload })),
          options,
        );
        if (error) throw new Error(error.message);
      }
      result.sent += chunk.length;
    } catch (err) {
      result.failed += chunk.length;
      logger
        .withMetadata({
          eventType: event.type,
          chunk: i / BATCH_LIMIT,
          chunkSize: chunk.length,
          reason: serializeError(err).message,
        })
        .error("notification.failed");
    }
  }

  if (result.sent > 0) {
    logger.withMetadata({ eventType: event.type }).info("notification.sent");
  }
  return result;
}
