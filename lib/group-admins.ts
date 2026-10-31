import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

interface AdminMembershipRow {
  profile_id: string | null;
}

/**
 * Resolves the email addresses of all admins of a group. Used to build
 * recipient lists for admin-facing notifications (join, leave, account
 * deletion). Excludes profileId when given (e.g. the caller triggering the
 * event, who doesn't need to notify themself).
 */
export async function getGroupAdminEmails(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  excludeProfileId?: string,
): Promise<string[]> {
  let query = admin
    .from("memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "admin");
  if (excludeProfileId) query = query.neq("profile_id", excludeProfileId);

  const { data } = await query;
  const profileIds = ((data ?? []) as AdminMembershipRow[])
    .map((m) => m.profile_id)
    .filter((id): id is string => id !== null);

  const emails = await Promise.all(
    profileIds.map(async (profileId) => {
      const { data: userData } = await admin.auth.admin.getUserById(profileId);
      return userData?.user?.email ?? null;
    }),
  );
  return emails.filter((e): e is string => !!e);
}

export interface GroupContact {
  name: string;
  email: string;
}

async function resolveContactForProfile(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<GroupContact | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", profileId)
    .single();
  if (!profile) return null;

  const { data: userData } = await admin.auth.admin.getUserById(profileId);
  const email = userData?.user?.email;
  if (!email) return null;

  const p = profile as { first_name: string; last_name: string };
  return { name: `${p.first_name} ${p.last_name}`, email };
}

/**
 * Resolves the "admin contact" shown in participant-facing emails (draw,
 * re-draw, group deletion). Tries, in order: the admin who triggered the
 * action, then any other admin with a resolvable profile + email. Returns
 * null (never throws) if no contact can be resolved — e.g. every admin's
 * account has been deleted — so callers must send a contact-less email
 * variant instead of skipping the notification.
 */
export async function resolveGroupContact(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  actingProfileId: string,
): Promise<GroupContact | null> {
  const actingContact = await resolveContactForProfile(admin, actingProfileId);
  if (actingContact) return actingContact;

  const { data: admins } = await admin
    .from("memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "admin")
    .neq("profile_id", actingProfileId);

  const candidates = ((admins ?? []) as { profile_id: string | null }[])
    .map((m) => m.profile_id)
    .filter((id): id is string => id !== null);
  // Resolve in parallel; keep membership order for the first hit.
  const contacts = await Promise.all(
    candidates.map((id) => resolveContactForProfile(admin, id)),
  );
  const contact = contacts.find((c) => c !== null);
  if (contact) return contact;

  logger.withMetadata({ groupId }).warn("group_contact.unresolved");
  return null;
}
