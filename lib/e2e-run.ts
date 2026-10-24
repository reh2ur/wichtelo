import { randomBytes } from "node:crypto";

// Run-scoped identity for E2E test users. Several PR runs share one staging
// Supabase, so every fixture-created user carries the id of the run that made
// it and teardown only touches that prefix (plus long-stale leftovers).

const RUN_ID_PATTERN = /^[a-z0-9]{1,40}$/;

/** Users older than this are leftovers of crashed runs; any teardown sweeps them. */
export const STALE_E2E_USER_MS = 6 * 60 * 60 * 1000;

export function isValidRunId(runId: unknown): runId is string {
  return typeof runId === "string" && RUN_ID_PATTERN.test(runId);
}

/**
 * Stable per CI run (and per re-run attempt), random locally. Pass the env
 * explicitly so the logic stays testable.
 */
export function resolveRunId(
  env: Record<string, string | undefined>,
  random: () => string = () => randomBytes(4).toString("hex"),
): string {
  const explicit = env.E2E_RUN_ID?.toLowerCase();
  if (explicit && isValidRunId(explicit)) return explicit;

  const ghRun = env.GITHUB_RUN_ID?.replace(/[^0-9]/g, "");
  if (ghRun) {
    const attempt = env.GITHUB_RUN_ATTEMPT?.replace(/[^0-9]/g, "") || "1";
    return `${ghRun}a${attempt}`.slice(0, 40);
  }
  return random();
}

/** Email prefix shared by every fixture user of one run. */
export function e2eEmailPrefix(runId: string): string {
  return `e2e+r${runId}-`;
}

export function e2eWorkerEmail(runId: string, workerIndex: number): string {
  return `${e2eEmailPrefix(runId)}worker-${workerIndex}@test.local`;
}

export function e2eFreshEmail(runId: string, nonce: string): string {
  return `${e2eEmailPrefix(runId)}fresh-${nonce}@test.local`;
}

interface CleanupCandidate {
  email?: string | null;
  created_at?: string | null;
}

/**
 * Which users a teardown may delete: the current run's prefix, and any other
 * `e2e+` user older than the stale cutoff. Never a younger user of another run.
 * Without a runId (invalid / absent) only the stale sweep applies.
 */
export function selectCleanupUsers<T extends CleanupCandidate>(
  users: T[],
  options: { runId?: string | null; now?: number; staleMs?: number },
): T[] {
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? STALE_E2E_USER_MS;
  const prefix = isValidRunId(options.runId)
    ? e2eEmailPrefix(options.runId)
    : null;

  return users.filter((u) => {
    const email = u.email ?? "";
    if (!email.startsWith("e2e+")) return false;
    if (prefix && email.startsWith(prefix)) return true;
    const created = u.created_at ? Date.parse(u.created_at) : NaN;
    return Number.isFinite(created) && now - created > staleMs;
  });
}
