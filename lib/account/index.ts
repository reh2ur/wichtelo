import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { isProductionDeploy } from "@/lib/env";

export interface AffectedDrawnGroup {
  groupId: string;
  name: string;
  slug: string;
  adminEmails: string[];
}

export type AffectedOpenGroup = AffectedDrawnGroup;

export interface DeleteAccountResult {
  affectedDrawnGroups: AffectedDrawnGroup[];
  /** Open groups: the membership was removed entirely (not just nulled). */
  affectedOpenGroups: AffectedOpenGroup[];
  /** Slugs of every group whose cached data is now stale. */
  affectedSlugs: string[];
  nullifiedMembershipCount: number;
}

// Dedicated secret, never the service-role key. Dev/tests/previews get a fixed
// fallback; real production throws (also caught at boot by lib/env.ts).
const DEV_SECRET = "dev-only-account-deletion-secret";

function getTokenSecret(): string {
  const secret = process.env.ACCOUNT_DELETION_SECRET;
  if (secret) return secret;
  if (isProductionDeploy()) {
    throw new Error("ACCOUNT_DELETION_SECRET is not set");
  }
  return DEV_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", getTokenSecret())
    .update(payload)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Token format: `userId.expires.nonce.hmac`. Nonce makes it single-use. */
export function createDeletionToken(userId: string, nonce: string): string {
  const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return `${userId}.${expires}.${nonce}.${sign(`${userId}:${expires}:${nonce}`)}`;
}

export function verifyDeletionToken(
  token: string,
): { valid: false } | { valid: true; userId: string; nonce: string } {
  const parts = token.split(".");
  if (parts.length !== 4) return { valid: false };
  const [userId, expiresStr, nonce, hmac] = parts;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || Math.floor(Date.now() / 1000) > expires)
    return { valid: false };
  if (!safeEqual(hmac, sign(`${userId}:${expires}:${nonce}`)))
    return { valid: false };
  return { valid: true, userId, nonce };
}

/**
 * Mint a fresh deletion token and store its nonce on the auth user
 * (`app_metadata.deletion_nonce`). A newer request replaces the nonce, so
 * older links stop working; deleting the user kills the last one.
 */
export async function issueDeletionToken(userId: string): Promise<string> {
  const nonce = randomBytes(16).toString("base64url");
  const { error } = await createAdminClient().auth.admin.updateUserById(
    userId,
    { app_metadata: { deletion_nonce: nonce } },
  );
  if (error) throw error;
  return createDeletionToken(userId, nonce);
}

/** True iff `nonce` is the user's currently stored deletion nonce. */
export async function isDeletionNonceCurrent(
  userId: string,
  nonce: string,
): Promise<boolean> {
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  const stored = data?.user?.app_metadata?.deletion_nonce;
  return typeof stored === "string" && safeEqual(stored, nonce);
}

interface MembershipRow {
  id: string;
  group_id: string;
  groups: { id: string; name: string; slug: string; state: string } | null;
}

interface AdminMembershipRow {
  profile_id: string | null;
}

export interface SoleAdminGroup {
  groupId: string;
  name: string;
  slug: string;
}

/**
 * Groups where `userId` is the only admin with a live account. Deleting the
 * account would leave them without a functional admin.
 */
export async function findSoleAdminGroups(
  userId: string,
): Promise<SoleAdminGroup[]> {
  const admin = createAdminClient();

  const { data: ownRaw } = await admin
    .from("memberships")
    .select("group_id, groups(id, name, slug)")
    .eq("profile_id", userId)
    .eq("role", "admin");

  const own = (ownRaw ?? []) as unknown as {
    group_id: string;
    groups: { id: string; name: string; slug: string } | null;
  }[];

  const result: SoleAdminGroup[] = [];
  for (const m of own) {
    if (!m.groups) continue;
    const { data: others } = await admin
      .from("memberships")
      .select("id")
      .eq("group_id", m.group_id)
      .eq("role", "admin")
      .not("profile_id", "is", null)
      .neq("profile_id", userId);
    if ((others ?? []).length === 0) {
      result.push({
        groupId: m.groups.id,
        name: m.groups.name,
        slug: m.groups.slug,
      });
    }
  }
  return result;
}

async function collectAdminEmails(
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  userId: string,
): Promise<string[]> {
  const { data: adminMembershipsRaw } = await admin
    .from("memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "admin")
    .neq("profile_id", userId);

  const adminProfileIds = ((adminMembershipsRaw ?? []) as AdminMembershipRow[])
    .map((a) => a.profile_id)
    .filter((id): id is string => id !== null);

  return (
    await Promise.all(
      adminProfileIds.map(async (profileId) => {
        const { data: userData } =
          await admin.auth.admin.getUserById(profileId);
        return userData?.user?.email ?? null;
      }),
    )
  ).filter((email): email is string => !!email);
}

/**
 * Deletes the auth user. Open-group memberships are removed first (see
 * below). Drawn groups keep the nulled membership
 * (`name_snapshot` preserved, assignments intact). Open groups lose the
 * membership entirely so the deleted account can never be drawn; cascades
 * remove its exclusions.
 */
export async function deleteAccount(
  userId: string,
): Promise<DeleteAccountResult> {
  const admin = createAdminClient();

  const { data: membershipsRaw } = await admin
    .from("memberships")
    .select("id, group_id, groups(id, name, slug, state)")
    .eq("profile_id", userId);

  const memberships = (membershipsRaw ?? []) as unknown as MembershipRow[];
  const nullifiedMembershipCount = memberships.length;

  const describe = async (m: MembershipRow): Promise<AffectedDrawnGroup> => ({
    groupId: m.groups!.id,
    name: m.groups!.name,
    slug: m.groups!.slug,
    adminEmails: await collectAdminEmails(admin, m.groups!.id, userId),
  });

  const live = memberships.filter((m) => m.groups);
  const described = await Promise.all(
    live.map(async (m) => ({ m, group: await describe(m) })),
  );
  const affectedDrawnGroups = described
    .filter(({ m }) => m.groups!.state === "drawn")
    .map(({ group }) => group);
  const openEntries = described.filter(({ m }) => m.groups!.state !== "drawn");
  const affectedOpenGroups: AffectedOpenGroup[] = openEntries.map(
    ({ group }) => group,
  );
  const openMembershipIds = openEntries.map(({ m }) => m.id);

  if (openMembershipIds.length > 0) {
    // Remove open-group memberships BEFORE deleteUser: afterwards they would
    // be profile_id = null rows that look like normal members and could be
    // drawn (#244). A failure here aborts the deletion; user can retry.
    const { error } = await admin
      .from("memberships")
      .delete()
      .in("id", openMembershipIds);
    if (error) {
      logger
        .withMetadata({ userId, reason: error.message })
        .error("account.open_membership_cleanup_failed");
      throw error;
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;

  const affectedSlugs = [...affectedDrawnGroups, ...affectedOpenGroups].map(
    (g) => g.slug,
  );

  return {
    affectedDrawnGroups,
    affectedOpenGroups,
    affectedSlugs,
    nullifiedMembershipCount,
  };
}
