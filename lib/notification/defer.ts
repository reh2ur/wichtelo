import { after } from "next/server";
import { reportError } from "@/lib/report-error";

/**
 * Runs a best-effort notice (joined, left, removed, group deleted) after the
 * response is sent, so mail retries/backoff never sit in front of the user's
 * click. Never use for mails whose counts the caller needs (draw flows).
 * Failures are reported, never thrown. Outside a request scope (unit tests,
 * scripts) `after` throws; the task then runs immediately.
 */
export function deferNotice(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      reportError("notification.deferred_failed", err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
