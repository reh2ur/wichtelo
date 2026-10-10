import type { createAdminClient } from "@/lib/supabase/admin";

type RemoveMembershipResult =
  | "ok"
  | "group_not_found"
  | "member_not_found"
  | "already_drawn"
  | "last_admin"
  | "error";

interface RemoveMembershipOptions {
  /** Admin removal after the draw. Cascades away the member's assignment rows. */
  allowDrawn?: boolean;
  /** Refuse to remove the last admin with a live account. Default true. */
  enforceLastAdmin?: boolean;
}

const KNOWN_RESULTS: ReadonlySet<string> = new Set([
  "ok",
  "group_not_found",
  "member_not_found",
  "already_drawn",
  "last_admin",
]);

/**
 * Remove a membership through the `remove_membership` RPC, which locks the
 * group row so a concurrent draw cannot slip between the state check and the
 * delete. Plain deletes on a drawn group are rejected by a DB trigger.
 * Returns "error" on any transport/DB failure (message in `reason`).
 */
export async function removeMembership(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  membershipId: string,
  options: RemoveMembershipOptions = {},
): Promise<{ result: RemoveMembershipResult; reason?: string }> {
  const { data, error } = await admin.rpc("remove_membership", {
    p_group_id: groupId,
    p_membership_id: membershipId,
    p_allow_drawn: options.allowDrawn ?? false,
    p_enforce_last_admin: options.enforceLastAdmin ?? true,
  });
  if (error) return { result: "error", reason: error.message };
  if (typeof data !== "string" || !KNOWN_RESULTS.has(data)) {
    return { result: "error", reason: `unexpected result: ${String(data)}` };
  }
  return { result: data as RemoveMembershipResult };
}
