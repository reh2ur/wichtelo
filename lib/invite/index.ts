import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export interface ResolvedInvite {
  group: {
    id: string;
    slug: string;
    name: string;
    state: "open" | "drawn";
    created_by: string;
    budget_hint: string | null;
    note: string | null;
  };
  adminName: string;
}

/**
 * Creates a new invite token for a group.
 * Returns the UUID token string.
 */
export async function createToken(groupId: string): Promise<string> {
  const supabase = createAdminClient();
  const token = crypto.randomUUID();
  const { error } = await supabase
    .from("invite_tokens")
    .insert({ group_id: groupId, token });
  if (error) {
    throw new Error(`[createToken] insert failed: ${error.message}`);
  }
  return token;
}

/**
 * Replaces a group's invite token with a fresh one, invalidating the old link.
 * One row per group (unique group_id): update in place, create if missing.
 * Returns the new token.
 */
export async function rotateToken(groupId: string): Promise<string> {
  const supabase = createAdminClient();
  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from("invite_tokens")
    .update({ token })
    .eq("group_id", groupId)
    .select("id");
  if (error) {
    throw new Error(`[rotateToken] update failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return createToken(groupId);
  }
  return token;
}

/**
 * Returns an existing token for a group, or creates one if none exists.
 * Race-safe: relies on the unique constraint on invite_tokens.group_id so
 * concurrent callers converge on a single token instead of creating
 * multiple rows for the same group.
 */
export async function getOrCreateToken(groupId: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("invite_tokens")
    .select("token")
    .eq("group_id", groupId)
    .maybeSingle();
  if (existing?.token) return existing.token;

  // No row yet — try to create one. The unique constraint on group_id
  // makes concurrent inserts converge: the loser gets a conflict error
  // and falls back to reading the winner's row.
  try {
    return await createToken(groupId);
  } catch {
    // Conflict — a concurrent caller won the race.
  }

  const { data: winner, error: selectError } = await supabase
    .from("invite_tokens")
    .select("token")
    .eq("group_id", groupId)
    .single();

  if (selectError || !winner) {
    throw new Error(
      `[getOrCreateToken] existing token lookup failed: ${selectError?.message}`,
    );
  }
  return winner.token;
}

/**
 * Resolves an invite token.
 * - Returns ResolvedInvite for both open and drawn groups (check group.state)
 * - Returns null when token not found
 */
export async function resolveToken(
  token: string,
): Promise<ResolvedInvite | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("invite_tokens")
    .select(
      `token, group_id,
       groups!inner(id, slug, name, state, created_by, budget_hint, note)`,
    )
    .eq("token", token)
    .single();

  if (!data) {
    return null;
  }

  // Supabase returns joined table as object, handle type cast
  const group = data.groups as unknown as {
    id: string;
    slug: string;
    name: string;
    state: "open" | "drawn";
    created_by: string;
    budget_hint: string | null;
    note: string | null;
  };

  // Fetch admin name regardless of state (needed for dead-end contact info)
  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", group.created_by)
    .single();

  // Invite link holders may never join: expose first name + last initial only
  // (PRD story 32, issue #179).
  const lastInitial = adminProfile?.last_name.trim().charAt(0) ?? "";
  const adminName = adminProfile
    ? `${adminProfile.first_name}${lastInitial ? ` ${lastInitial}.` : ""}`
    : "";

  if (group.state === "drawn") {
    logger.withMetadata({ groupId: group.id }).warn("invite.dead_end");
  } else {
    logger.withMetadata({ groupId: group.id }).info("invite.resolved");
  }

  return { group, adminName };
}
