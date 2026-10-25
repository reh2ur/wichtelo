import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface GroupRow {
  id: string;
  slug: string;
  name: string;
  year: number;
  state: "open" | "drawn";
  draw_version: number;
}

export interface CallerMembership {
  id: string;
  role: "participant" | "admin";
  name_snapshot: string;
}

/**
 * Lookup outcome that keeps "no such row" (`row: null`) apart from "the DB
 * call failed" (`failed: true`). Actions map the first to not_admin /
 * not_member and the second to `generic`, so a DB blip never tells a real
 * admin "you are not an admin". The failure is logged here.
 */
export type Lookup<T> = { failed: false; row: T | null } | { failed: true };

export async function findGroupBySlug(
  admin: AdminClient,
  slug: string,
): Promise<Lookup<GroupRow>> {
  const { data, error } = await admin
    .from("groups")
    .select("id, slug, name, year, state, draw_version")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    logger
      .withMetadata({ slug, reason: error.message })
      .error("group.lookup_failed");
    return { failed: true };
  }
  return { failed: false, row: (data as GroupRow | null) ?? null };
}

export async function findCallerMembership(
  admin: AdminClient,
  groupId: string,
  profileId: string,
): Promise<Lookup<CallerMembership>> {
  const { data, error } = await admin
    .from("memberships")
    .select("id, role, name_snapshot")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    logger
      .withMetadata({ groupId, reason: error.message })
      .error("membership.lookup_failed");
    return { failed: true };
  }
  return { failed: false, row: (data as CallerMembership | null) ?? null };
}
