import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/report-error";

export interface DrawMailWarning {
  failed: number;
  total: number;
}

interface FailureRow {
  draw_version: number;
  failed: number;
  total: number;
}

/**
 * A stored failure only counts for the draw it was recorded for. After a
 * re-draw the group's draw_version moves on, so an old row (e.g. the new send
 * never reached the write) is ignored instead of resurfacing a stale warning.
 */
export function warningForDraw(
  row: FailureRow | null | undefined,
  currentDrawVersion: number | null | undefined,
): DrawMailWarning | null {
  if (!row || currentDrawVersion == null) return null;
  if (row.draw_version !== currentDrawVersion) return null;
  if (row.failed <= 0) return null;
  return { failed: row.failed, total: row.total };
}

/**
 * Persist the outcome of a mail send (service role). `failed = 0` clears the
 * warning. `total = 0` (nobody was mailed) is ignored: it means the recipient
 * set was lost, not that everything went out, so it must not clear a stored
 * warning. Never throws: mails are already out, a bookkeeping error must not
 * turn the action into a failure.
 */
export async function recordDrawMailResult(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  drawVersion: number,
  failed: number,
  total: number,
): Promise<void> {
  if (total <= 0) {
    logger.withMetadata({ groupId }).warn("draw.mail_status_empty_ignored");
    return;
  }
  try {
    const { error } = await admin.rpc("record_draw_mail_result", {
      p_group_id: groupId,
      p_draw_version: drawVersion,
      p_failed: failed,
      p_total: total,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    reportError("draw.mail_status_record_failed", err, { groupId });
  }
}

/**
 * Reads the pending warning with the caller's JWT: RLS only returns the row to
 * group admins, everyone else gets `null`.
 */
export async function fetchDrawMailWarning(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
): Promise<DrawMailWarning | null> {
  const [{ data: row }, { data: group }] = await Promise.all([
    supabase
      .from("draw_mail_failures")
      .select("draw_version, failed, total")
      .eq("group_id", groupId)
      .maybeSingle(),
    supabase
      .from("groups")
      .select("draw_version")
      .eq("id", groupId)
      .maybeSingle(),
  ]);
  return warningForDraw(
    row as FailureRow | null,
    (group as { draw_version: number } | null)?.draw_version,
  );
}
