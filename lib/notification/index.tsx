import { createHash } from "node:crypto";
import type { ReactElement } from "react";
import { resend, FROM_EMAIL } from "@/lib/email";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/report-error";
import { DrawAssignmentEmail } from "@/emails/draw-assignment";
import { GroupDeletedEmail } from "@/emails/group-deleted";
import { ParticipantJoinedEmail } from "@/emails/participant-joined";
import { ParticipantLeftConfirmationEmail } from "@/emails/participant-left-confirmation";
import { ParticipantRemovedEmail } from "@/emails/participant-removed";
import { ParticipantLeftAdminNoticeEmail } from "@/emails/participant-left-admin-notice";
import { AccountDeletionEmail } from "@/emails/account-deletion";
import { AccountDeletionConfirmedEmail } from "@/emails/account-deletion-confirmed";
import { AccountDeletionAdminNoticeEmail } from "@/emails/account-deletion-admin-notice";
import { AccountInactivityWarningEmail } from "@/emails/account-inactivity-warning";

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
      /**
       * Unique per draw: the post-draw `draw_version` (strictly increasing,
       * never reset). Trigger, re-draw and resend must all use it so a resend
       * reuses the original Resend idempotency keys.
       */
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
      adminEmails: string[];
    }
  | {
      type: "participant.removed";
      groupName: string;
      participantEmail: string;
      /** Admin contact shown to the removed person (PRD #33). */
      adminName: string | null;
      adminEmail: string | null;
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
      type: "account.inactivity_warning";
      to: string;
      name: string;
      /** German date the account will be deleted, e.g. "30. November 2026". */
      deletionDate: string;
    }
  | {
      type: "account.deletion_admin_notice";
      groupName: string;
      /** Name of the member whose account was deleted (membership snapshot). */
      participantName: string;
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
  to: string;
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
      return event.adminEmails.map((to) => ({
        to,
        subject: `Wichtelo ${event.groupName}: Neuer Teilnehmer beigetreten`,
        react: (
          <ParticipantJoinedEmail
            groupName={event.groupName}
            participantName={event.participantName}
          />
        ),
      }));

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
      for (const to of event.adminEmails) {
        payloads.push({
          to,
          subject: `Wichtelo ${event.groupName}: Teilnehmer hat die Gruppe verlassen`,
          react: (
            <ParticipantLeftAdminNoticeEmail
              groupName={event.groupName}
              participantName={event.participantName}
            />
          ),
        });
      }
      return payloads;
    }

    case "participant.removed":
      return [
        {
          to: event.participantEmail,
          subject: `Wichtelo ${event.groupName}: Du wurdest aus der Gruppe entfernt`,
          react: (
            <ParticipantRemovedEmail
              groupName={event.groupName}
              adminName={event.adminName}
              adminEmail={event.adminEmail}
            />
          ),
        },
      ];

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

    case "account.inactivity_warning":
      return [
        {
          to: event.to,
          subject: "Wichtelo: Dein Konto wird bald gelöscht",
          react: (
            <AccountInactivityWarningEmail
              name={event.name}
              deletionDate={event.deletionDate}
            />
          ),
        },
      ];

    case "account.deletion_admin_notice":
      return event.adminEmails.map((to) => ({
        to,
        subject: `Wichtelo: Teilnehmer hat Konto gelöscht – ${event.groupName}`,
        react: (
          <AccountDeletionAdminNoticeEmail
            groupName={event.groupName}
            participantName={event.participantName}
            postDraw={event.postDraw}
          />
        ),
      }));
  }
}

/** Max sends per chunk (first try + retries) on Resend 429/5xx. */
export const MAX_ATTEMPTS = 3;
/** Backoff before retry n (1-based): base * 2^(n-1). */
export const RETRY_BASE_DELAY_MS = 500;

class ResendSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof ResendSendError)) return false;
  // 409 concurrent_idempotent_requests: same key still in flight, safe to retry.
  if (err.statusCode === 409 && err.code === "concurrent_idempotent_requests") {
    return true;
  }
  return (
    err.statusCode === 429 || (err.statusCode !== null && err.statusCode >= 500)
  );
}

/**
 * Resend answers 409 `invalid_idempotent_request` when a key is reused with a
 * different payload (e.g. resend after failed recipient lookups recovered, so
 * chunk contents shifted). Retrying the same key can never succeed.
 */
function isIdempotencyPayloadMismatch(err: unknown): boolean {
  return (
    err instanceof ResendSendError &&
    err.statusCode === 409 &&
    err.code !== "concurrent_idempotent_requests"
  );
}

/** Stable short fingerprint of a chunk's recipients + subjects. */
function chunkFingerprint(chunk: EmailPayload[]): string {
  return createHash("sha256")
    .update(chunk.map((p) => `${String(p.to)}|${p.subject}`).join("\n"))
    .digest("hex")
    .slice(0, 12);
}

async function sendChunk(
  chunk: EmailPayload[],
  options: { idempotencyKey: string } | undefined,
): Promise<void> {
  const { error } =
    chunk.length === 1
      ? await resend.emails.send({ from: FROM_EMAIL, ...chunk[0] }, options)
      : await resend.batch.send(
          chunk.map((payload) => ({ from: FROM_EMAIL, ...payload })),
          options,
        );
  if (error) {
    throw new ResendSendError(
      error.message,
      error.statusCode ?? null,
      (error as { name?: string }).name ?? null,
    );
  }
}

/** Bounded retry with exponential backoff on 429/5xx only. */
async function sendChunkWithRetry(
  chunk: EmailPayload[],
  options: { idempotencyKey: string } | undefined,
): Promise<void> {
  let rekeyed = false;
  for (let attempt = 1; ; attempt++) {
    try {
      await sendChunk(chunk, options);
      return;
    } catch (err) {
      if (options && !rekeyed && isIdempotencyPayloadMismatch(err)) {
        rekeyed = true;
        // Payload changed since the original send: the old key is poisoned
        // for 24h. Fall back to a payload-scoped key (may re-mail a chunk
        // whose first send was delivered, but beats a permanently stuck resend).
        options = {
          idempotencyKey: `${options.idempotencyKey}:p${chunkFingerprint(chunk)}`,
        };
        continue;
      }
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      await new Promise((r) =>
        setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)),
      );
    }
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
 * per chunk. Retries a chunk (max 3 tries, backoff) on Resend 429/5xx. Never throws — delivery failures are logged and reported via the
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
      await sendChunkWithRetry(chunk, options);
      result.sent += chunk.length;
    } catch (err) {
      result.failed += chunk.length;
      reportError("notification.failed", err, {
        eventType: event.type,
        chunk: i / BATCH_LIMIT,
        chunkSize: chunk.length,
      });
    }
  }

  if (result.sent > 0) {
    logger.withMetadata({ eventType: event.type }).info("notification.sent");
  }
  return result;
}
