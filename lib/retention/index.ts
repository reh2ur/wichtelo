import { findSoleAdminGroups, deleteAccount } from "@/lib/account";
import { notifyAccountDeleted } from "@/lib/account/notify";
import { fetchAllRows } from "@/lib/admin/paged";
import { listAllAuthUsers } from "@/lib/admin/auth-users";
import { isSuperAdminEmail } from "@/lib/admin/super-admin-email";
import { logger } from "@/lib/logger";
import { notify } from "@/lib/notification";
import { reportError } from "@/lib/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  INACTIVITY_WARNED_KEY,
  auditLogCutoff,
  deletionDateAfterWarning,
  inactiveWarnCutoff,
  maxExpiredGroupYear,
  planInactiveAccount,
} from "./policy";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Rows per DELETE ... IN (...) call. */
const DELETE_CHUNK = 100;
/** Per-run caps so a backlog (first run) cannot burst mail quota / run time. Remainder follows next day. */
const MAX_WARNINGS_PER_RUN = 100;
export const MAX_ACCOUNT_DELETIONS_PER_RUN = 50;

export interface RetentionReport {
  groupsDeleted: number;
  auditRowsDeleted: number;
  accountsWarned: number;
  accountsDeleted: number;
  /** Step/user failures. Non-empty = run is not clean (route answers 500). */
  failures: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * Deletes groups whose year is past retention. Cascades take memberships,
 * assignments, exclusions, invite token, draw-mail failure + assignment
 * lookup rows; the memberships delete guard passes because the parent group
 * row is gone. Name snapshots disappear with the memberships.
 */
async function deleteExpiredGroups(
  admin: AdminClient,
  now: Date,
  report: RetentionReport,
): Promise<void> {
  const maxYear = maxExpiredGroupYear(now);
  const rows = await fetchAllRows<{ id: string }>("retention groups", (f, t) =>
    admin
      .from("groups")
      .select("id")
      .lte("year", maxYear)
      .order("id")
      .range(f, t),
  );
  for (const ids of chunks(
    rows.map((r) => r.id),
    DELETE_CHUNK,
  )) {
    const { error, count } = await admin
      .from("groups")
      .delete({ count: "exact" })
      .in("id", ids)
      .lte("year", maxYear); // re-check: never delete on a stale id list
    if (error) throw new Error(`group delete failed: ${error.message}`);
    report.groupsDeleted += count ?? 0;
  }
}

async function deleteOldAuditRows(
  admin: AdminClient,
  now: Date,
  report: RetentionReport,
): Promise<void> {
  const { error, count } = await admin
    .from("admin_audit_log")
    .delete({ count: "exact" })
    .lt("created_at", auditLogCutoff(now).toISOString());
  if (error) throw new Error(`audit log delete failed: ${error.message}`);
  report.auditRowsDeleted += count ?? 0;
}

function germanDate(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "long",
    timeZone: "Europe/Berlin",
  }).format(date);
}

async function profileName(
  admin: AdminClient,
  userId: string,
  fallback: string,
): Promise<string> {
  const { data, error } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  return data ? `${data.first_name} ${data.last_name}` : fallback;
}

/**
 * Warns, then (after the grace period) deletes accounts with no activity for
 * 3 years. Activity = last sign-in, or joining a group (session refresh does
 * not move last_sign_in_at, so group joins count too). Reads fail closed: any
 * error before planning aborts the step, nothing is deleted on partial data.
 * Per-user failures are collected and do not stop the other users. Deletion
 * reuses `deleteAccount` (sole-admin guard, membership cleanup, admin
 * notices) exactly like the self-service and super-admin paths.
 */
async function processInactiveAccounts(
  admin: AdminClient,
  now: Date,
  report: RetentionReport,
): Promise<void> {
  const users = await listAllAuthUsers(admin);

  // Latest join per profile, only for joins that could still count as activity.
  const since = inactiveWarnCutoff(now).toISOString();
  const joins = await fetchAllRows<{
    id: string;
    profile_id: string | null;
    joined_at: string;
  }>("retention memberships", (f, t) =>
    admin
      .from("memberships")
      .select("id, profile_id, joined_at")
      .not("profile_id", "is", null)
      .gte("joined_at", since)
      .order("id")
      .range(f, t),
  );
  const lastJoined = new Map<string, string>();
  for (const j of joins) {
    if (!j.profile_id) continue;
    const prev = lastJoined.get(j.profile_id);
    if (!prev || j.joined_at > prev) lastJoined.set(j.profile_id, j.joined_at);
  }

  let warnings = 0;
  let deletions = 0;

  for (const user of users) {
    if (isSuperAdminEmail(user.email)) continue;
    const warnedAt = user.app_metadata?.[INACTIVITY_WARNED_KEY];
    const action = planInactiveAccount(
      {
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
        lastJoinedAt: lastJoined.get(user.id),
        warnedAt: typeof warnedAt === "string" ? warnedAt : null,
      },
      now,
    );
    if (action === "keep") continue;

    try {
      if (action === "warn") {
        if (warnings >= MAX_WARNINGS_PER_RUN) continue;
        if (!user.email) continue; // nobody to warn, and nobody to notify
        const name = await profileName(admin, user.id, user.email);
        const result = await notify({
          type: "account.inactivity_warning",
          to: user.email,
          name,
          deletionDate: germanDate(deletionDateAfterWarning(now)),
        });
        // Stamp only after the mail was handed over: no warning, no deletion.
        if (result.sent !== 1) throw new Error("warning mail not sent");
        const { error } = await admin.auth.admin.updateUserById(user.id, {
          app_metadata: { [INACTIVITY_WARNED_KEY]: now.toISOString() },
        });
        if (error) throw error;
        warnings++;
        report.accountsWarned++;
      } else {
        if (deletions >= MAX_ACCOUNT_DELETIONS_PER_RUN) continue;
        const soleAdmin = await findSoleAdminGroups(user.id);
        if (soleAdmin.length > 0) {
          // Other members still depend on this admin; retry daily, the groups
          // expire by themselves.
          logger
            .withMetadata({ groups: soleAdmin.length })
            .warn("retention.account_skipped_sole_admin");
          continue;
        }
        // Capture before deleteAccount removes the user (+ profile cascade).
        const name = await profileName(admin, user.id, user.email ?? "");
        const result = await deleteAccount(user.id);
        deletions++;
        report.accountsDeleted++;
        await notifyAccountDeleted(result, user.email, name);
      }
    } catch (err) {
      report.failures.push(`account.${action}`);
      reportError("retention.account_failed", err, { action });
    }
  }
}

/**
 * Scheduled GDPR retention cleanup (issue #102). Idempotent: every step only
 * acts on data past its cutoff, so reruns and retries are harmless. Steps are
 * independent; a failing step is reported (never swallowed) and does not stop
 * the others.
 */
export async function runRetention(
  now: Date = new Date(),
  admin: AdminClient = createAdminClient(),
): Promise<RetentionReport> {
  const report: RetentionReport = {
    groupsDeleted: 0,
    auditRowsDeleted: 0,
    accountsWarned: 0,
    accountsDeleted: 0,
    failures: [],
  };

  const steps: [string, () => Promise<void>][] = [
    ["groups", () => deleteExpiredGroups(admin, now, report)],
    ["audit_log", () => deleteOldAuditRows(admin, now, report)],
    ["inactive_accounts", () => processInactiveAccounts(admin, now, report)],
  ];
  for (const [step, run] of steps) {
    try {
      await run();
    } catch (err) {
      report.failures.push(step);
      reportError("retention.step_failed", err, { step });
    }
  }

  logger
    .withMetadata({
      groupsDeleted: report.groupsDeleted,
      auditRowsDeleted: report.auditRowsDeleted,
      accountsWarned: report.accountsWarned,
      accountsDeleted: report.accountsDeleted,
      failures: report.failures.length,
    })
    .info("retention.run_finished");
  return report;
}
