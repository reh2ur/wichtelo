import type { createAdminClient } from "@/lib/supabase/admin";
import type { Assignment } from "@/lib/draw";
import {
  abbreviateNames,
  membersFromMemberships,
} from "@/lib/name-abbreviator";
import type { DrawAssignmentRecipient } from "@/lib/notification";
import { logger } from "@/lib/logger";

export interface MembershipRow {
  id: string;
  role: "participant" | "admin";
  profile_id: string | null;
  name_snapshot: string;
  first_name_snapshot: string | null;
  last_name_snapshot: string | null;
}

/**
 * Post-draw `draw_version`: `perform_draw` locks the group row and only
 * proceeds when the stored version equals the expected one, then bumps it by
 * exactly one. Used as the Resend idempotency scope by trigger, re-draw and
 * resend alike, so all three produce identical keys for the same draw.
 */
export function postDrawVersion(expectedVersion: number): number {
  return expectedVersion + 1;
}

/** Resend event type for the current draw: re-draw once version exceeds 1. */
export function resendEventType(
  drawVersion: number,
): "draw.completed" | "draw.redrawn" {
  return drawVersion > 1 ? "draw.redrawn" : "draw.completed";
}

export interface DrawRecipients {
  recipients: DrawAssignmentRecipient[];
  /**
   * Givers with an account whose mail could not be built (user lookup failed,
   * no email, receiver unresolved). Counted as failed so the UI never says
   * "all sent" when someone was silently skipped.
   */
  skipped: number;
}

/**
 * Builds the per-participant email recipient list for a draw/re-draw:
 * resolves each giver's email address and each receiver's abbreviated
 * display name (same abbreviation shown on the group page).
 */
export async function buildDrawAssignmentRecipients(
  admin: ReturnType<typeof createAdminClient>,
  memberRows: MembershipRow[],
  assignment: Assignment,
): Promise<DrawRecipients> {
  const profileIds = memberRows
    .map((m) => m.profile_id)
    .filter((id): id is string => !!id);

  const profilesById = new Map<
    string,
    { first_name: string; last_name: string }
  >();
  if (profileIds.length > 0) {
    const { data } = await admin
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", profileIds);
    for (const p of (data ?? []) as {
      id: string;
      first_name: string;
      last_name: string;
    }[]) {
      profilesById.set(p.id, p);
    }
  }

  const receiverDisplayById = new Map(
    abbreviateNames(membersFromMemberships(memberRows, profilesById)).map(
      (d) => [d.id, d.displayName],
    ),
  );

  const emailByMembershipId = new Map<string, string>();
  // Parallel lookups: sequential getUserById per member risks serverless timeouts.
  await Promise.all(
    memberRows.map(async (m) => {
      if (!m.profile_id) return;
      const { data: userData, error } = await admin.auth.admin.getUserById(
        m.profile_id,
      );
      if (error) {
        logger
          .withMetadata({ membershipId: m.id, reason: error.message })
          .error("draw.recipient_lookup_failed");
        return;
      }
      if (userData?.user?.email) {
        emailByMembershipId.set(m.id, userData.user.email);
      }
    }),
  );

  const memberById = new Map(memberRows.map((m) => [m.id, m]));
  const recipients: DrawAssignmentRecipient[] = [];
  let skipped = 0;
  // Sorted by giver: payload (and thus Resend idempotency chunks) must be
  // identical on resend, independent of Map insertion order.
  const sortedPairs = Array.from(assignment.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [giverId, receiverId] of sortedPairs) {
    const to = emailByMembershipId.get(giverId);
    const receiverDisplayName = receiverDisplayById.get(receiverId);
    if (!to || !receiverDisplayName) {
      // Ghost givers (deleted account) have nobody to mail: not a failure.
      if (memberById.get(giverId)?.profile_id) skipped++;
      continue;
    }
    recipients.push({
      to,
      giverName: memberById.get(giverId)?.name_snapshot ?? "",
      receiverDisplayName,
    });
  }
  return { recipients, skipped };
}
