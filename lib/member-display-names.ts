import type { createAdminClient } from "@/lib/supabase/admin";
import {
  abbreviateNames,
  membersFromMemberships,
  type MembershipLike,
  type ProfileLike,
} from "@/lib/name-abbreviator";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ProfilesById = Map<string, ProfileLike & { id: string }>;

/** Profiles for the given members' `profile_id`s. Throws on DB error. */
export async function loadProfilesById(
  admin: AdminClient,
  members: { profile_id: string | null }[],
): Promise<ProfilesById> {
  const profileIds = members
    .map((m) => m.profile_id)
    .filter((id): id is string => !!id);
  const profilesById: ProfilesById = new Map();
  if (profileIds.length === 0) return profilesById;
  const { data, error } = await admin
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", profileIds);
  if (error) {
    throw new Error(`[loadProfilesById] failed: ${error.message}`);
  }
  for (const p of data ?? []) profilesById.set(p.id, p);
  return profilesById;
}

/**
 * Abbreviated display name per membership id (pure). Abbreviation is relative
 * to exactly the memberships passed in, i.e. one group's members.
 */
export function buildDisplayNameMap(
  memberships: MembershipLike[],
  profilesById: Map<string, ProfileLike>,
): Map<string, string> {
  return new Map(
    abbreviateNames(membersFromMemberships(memberships, profilesById)).map(
      (d) => [d.id, d.displayName],
    ),
  );
}

/**
 * Loads profiles for one group's memberships and returns membership id ->
 * abbreviated display name. Throws on DB error: a swallowed error would show
 * wrong (snapshot-fallback) names or drop recipients silently.
 */
export async function loadMemberDisplayNames(
  admin: AdminClient,
  memberships: MembershipLike[],
): Promise<Map<string, string>> {
  const profilesById = await loadProfilesById(admin, memberships);
  return buildDisplayNameMap(memberships, profilesById);
}
