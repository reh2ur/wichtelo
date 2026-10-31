/**
 * Retention periods (GDPR Art. 5(1)(e), issue #102). Pure date math only, so
 * every cutoff is unit-testable. All calendar arithmetic is UTC. Keep in sync
 * with `datenschutz.retention*` in messages/de.json.
 */

/** Groups (incl. assignments, memberships, exclusions) live this many months past 31 Dec of the group year. */
const GROUP_RETENTION_MONTHS = 6;
/** Accounts without sign-in or recent group join are deleted after this many years. */
const INACTIVE_ACCOUNT_YEARS = 3;
/** Warning mail goes out this many days before the deletion. */
const INACTIVE_WARNING_DAYS = 30;
/** Super-admin audit log rows live this many months. */
const AUDIT_LOG_RETENTION_MONTHS = 12;

/** `app_metadata` key holding the ISO time the inactivity warning went out. */
export const INACTIVITY_WARNED_KEY = "inactivity_warned_at";

const DAY_MS = 24 * 60 * 60 * 1000;

function subtractMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

function subtractYears(date: Date, years: number): Date {
  return subtractMonths(date, years * 12);
}

/**
 * Highest group `year` that is past retention: a group of year Y expires
 * GROUP_RETENTION_MONTHS after 31 Dec Y (30 Jun Y+1 → deletable from 1 Jul).
 * Delete groups with `year <= result`.
 */
export function maxExpiredGroupYear(now: Date): number {
  // Group year Y is expired iff now >= 1 Jul (Y+1), i.e. Dec 31 Y + 6 months.
  // Equivalent: Y <= (year of now - 6 months) - 1.
  return subtractMonths(now, GROUP_RETENTION_MONTHS).getUTCFullYear() - 1;
}

/** Audit rows with `created_at` before this are deleted. */
export function auditLogCutoff(now: Date): Date {
  return subtractMonths(now, AUDIT_LOG_RETENTION_MONTHS);
}

/** Last sign-in (or creation when never signed in) at or before this = deletion due, if warned. */
export function inactiveDeleteCutoff(now: Date): Date {
  return subtractYears(now, INACTIVE_ACCOUNT_YEARS);
}

/** Last activity at or before this = warning due. */
export function inactiveWarnCutoff(now: Date): Date {
  return new Date(
    inactiveDeleteCutoff(now).getTime() + INACTIVE_WARNING_DAYS * DAY_MS,
  );
}

export interface InactivityInput {
  /** auth.users.last_sign_in_at (null: never signed in). */
  lastSignInAt: string | null | undefined;
  /** auth.users.created_at. */
  createdAt: string;
  /** Latest membership join, ISO (null: none). Group activity counts as activity. */
  lastJoinedAt?: string | null;
  /** `app_metadata.inactivity_warned_at`, ISO. */
  warnedAt?: string | null;
}

export type InactivityAction = "keep" | "warn" | "delete";

function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Latest known activity (ms epoch); account creation is the floor. */
function lastActivityMs(input: InactivityInput): number {
  const candidates = [
    ts(input.createdAt),
    ts(input.lastSignInAt),
    ts(input.lastJoinedAt),
  ].filter((t): t is number => t !== null);
  // Unparseable createdAt and nothing else: treat as "now" so it is kept.
  return candidates.length > 0 ? Math.max(...candidates) : Infinity;
}

/**
 * Decides what the cleanup does with one account.
 * - keep: active, or warned too recently.
 * - warn: inactive beyond (3y - 30d) and no valid warning on record.
 * - delete: inactive beyond 3y AND a warning newer than the last activity
 *   went out at least 30 days ago. Never deletes unwarned accounts.
 * A warning older than the last activity is stale (user came back and went
 * inactive again) and does not count.
 */
export function planInactiveAccount(
  input: InactivityInput,
  now: Date,
): InactivityAction {
  const last = lastActivityMs(input);
  if (last > inactiveWarnCutoff(now).getTime()) return "keep";

  const warned = ts(input.warnedAt);
  const warnedValid = warned !== null && warned > last;
  if (!warnedValid) return "warn";

  const deleteDue = last <= inactiveDeleteCutoff(now).getTime();
  const gracePassed = now.getTime() - warned >= INACTIVE_WARNING_DAYS * DAY_MS;
  return deleteDue && gracePassed ? "delete" : "keep";
}

/** Date the account will be deleted, given the warning time. */
export function deletionDateAfterWarning(warnedAt: Date): Date {
  return new Date(warnedAt.getTime() + INACTIVE_WARNING_DAYS * DAY_MS);
}
