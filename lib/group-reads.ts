import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDisplayNameMap,
  loadProfilesById,
} from "@/lib/member-display-names";

/**
 * Page-level reads. Every helper throws on a DB error (never returns
 * `[]`/`null` for it) so a transient failure reaches `error.tsx` instead of
 * rendering a false empty state ("no groups", "no exclusions", missing
 * assignment).
 */

type UserClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

interface ListedGroup {
  id: string;
  slug: string;
  name: string;
  year: number;
  state: "open" | "drawn";
}

export interface MembershipWithGroup {
  id: string;
  role: "participant" | "admin";
  group_id: string;
  groups: ListedGroup;
}

interface NamedMembership {
  id: string;
  group_id?: string;
  name_snapshot: string;
  first_name_snapshot?: string | null;
  last_name_snapshot?: string | null;
  profile_id: string | null;
}

/** All memberships of `userId` with their group (RLS-scoped user client). */
export async function loadMembershipsWithGroups(
  supabase: UserClient,
  userId: string,
): Promise<MembershipWithGroup[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("id, role, group_id, groups!inner(id, slug, name, year, state)")
    .eq("profile_id", userId);
  if (error) {
    throw new Error(`[loadMembershipsWithGroups] failed: ${error.message}`);
  }
  // Stable list order: newest year first, then name.
  return (data ?? []).sort(
    (a, b) =>
      b.groups.year - a.groups.year ||
      a.groups.name.localeCompare(b.groups.name, "de"),
  );
}

/**
 * Receiver display name (abbreviated like everywhere else, #179) per group
 * for the viewer's assignments in the given drawn memberships. RLS lets
 * participants read only their own assignment row, so names are resolved
 * server-side with the admin client.
 */
export async function loadReceiverNamesByGroup(
  supabase: UserClient,
  admin: AdminClient,
  giverMembershipIds: string[],
): Promise<Record<string, string>> {
  const receiversByGroup: Record<string, string> = {};
  if (giverMembershipIds.length === 0) return receiversByGroup;

  const { data: assignments, error } = await supabase
    .from("assignments")
    .select("group_id, receiver_id")
    .in("giver_id", giverMembershipIds);
  if (error) {
    throw new Error(`[loadReceiverNamesByGroup] assignments: ${error.message}`);
  }
  const rows = (assignments ?? []) as {
    group_id: string;
    receiver_id: string;
  }[];
  if (rows.length === 0) return receiversByGroup;

  const { data: membersRaw, error: membersError } = await admin
    .from("memberships")
    .select("id, group_id, name_snapshot, profile_id")
    .in(
      "group_id",
      rows.map((a) => a.group_id),
    )
    .order("joined_at", { ascending: true })
    .order("id", { ascending: true });
  if (membersError) {
    throw new Error(
      `[loadReceiverNamesByGroup] memberships: ${membersError.message}`,
    );
  }
  const members = (membersRaw ?? []) as (NamedMembership & {
    group_id: string;
  })[];
  const profilesById = await loadProfilesById(admin, members);

  for (const a of rows) {
    const groupMembers = members.filter((m) => m.group_id === a.group_id);
    const display = buildDisplayNameMap(groupMembers, profilesById).get(
      a.receiver_id,
    );
    if (display) receiversByGroup[a.group_id] = display;
  }
  return receiversByGroup;
}

/**
 * Membership id of the viewer's own recipient in a drawn group, or `null`
 * when the viewer has no assignment row (orphaned after an admin removed a
 * member, #141). Uses the user client so RLS restricts the row to the
 * caller's own. Throws on DB error: a blip must not look like "no assignment".
 */
export async function loadMyReceiverId(
  supabase: UserClient,
  groupId: string,
  myMembershipId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("assignments")
    .select("receiver_id")
    .eq("group_id", groupId)
    // Admin RLS can read every row in the group, so filter to the caller's own.
    .eq("giver_id", myMembershipId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`[loadMyReceiverId] assignment: ${error.message}`);
  }
  return (data as { receiver_id: string } | null)?.receiver_id ?? null;
}

/**
 * Pure: live members (account still exists) with no outgoing assignment.
 * Ghosts (`profile_id` null) keep their assignment rows after account
 * deletion and are not counted.
 */
export function liveMembersWithoutAssignment(
  members: { id: string; profile_id: string | null }[],
  giverIds: Iterable<string>,
): string[] {
  const givers = new Set(giverIds);
  return members
    .filter((m) => m.profile_id !== null && !givers.has(m.id))
    .map((m) => m.id);
}

/**
 * True when a drawn group has live members without an assignment, i.e. an
 * admin removed someone after the draw and the chain is broken until the
 * admin re-draws (#141).
 */
export async function groupNeedsRedraw(
  admin: AdminClient,
  groupId: string,
): Promise<boolean> {
  const [membersRes, assignmentsRes] = await Promise.all([
    admin.from("memberships").select("id, profile_id").eq("group_id", groupId),
    admin.from("assignments").select("giver_id").eq("group_id", groupId),
  ]);
  if (membersRes.error) {
    throw new Error(
      `[groupNeedsRedraw] memberships: ${membersRes.error.message}`,
    );
  }
  if (assignmentsRes.error) {
    throw new Error(
      `[groupNeedsRedraw] assignments: ${assignmentsRes.error.message}`,
    );
  }
  return (
    liveMembersWithoutAssignment(
      (membersRes.data ?? []) as { id: string; profile_id: string | null }[],
      ((assignmentsRes.data ?? []) as { giver_id: string }[]).map(
        (a) => a.giver_id,
      ),
    ).length > 0
  );
}

export interface SettingsExclusionRow {
  id: string;
  member_a: string;
  member_b: string;
}

export interface SettingsMemberRow {
  id: string;
  name_snapshot: string;
  role: "participant" | "admin";
  profile_id: string | null;
}

export async function loadSettingsMemberships(
  admin: AdminClient,
  groupId: string,
): Promise<SettingsMemberRow[]> {
  const { data, error } = await admin
    .from("memberships")
    .select("id, name_snapshot, role, profile_id")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    throw new Error(`[loadSettingsMemberships] failed: ${error.message}`);
  }
  return (data ?? []) as SettingsMemberRow[];
}

export async function loadExclusions(
  admin: AdminClient,
  groupId: string,
): Promise<SettingsExclusionRow[]> {
  const { data, error } = await admin
    .from("exclusions")
    .select("id, member_a, member_b")
    .eq("group_id", groupId);
  if (error) {
    throw new Error(`[loadExclusions] failed: ${error.message}`);
  }
  return (data ?? []) as SettingsExclusionRow[];
}
