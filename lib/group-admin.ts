import type { User } from "@supabase/supabase-js";
import {
  findCallerMembership,
  findGroupBySlug,
  type CallerMembership,
  type GroupRow,
  type Lookup,
} from "@/lib/group-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

type RequireGroupAdminError =
  "not_authenticated" | "group_not_found" | "not_admin" | "generic";

export type RequireGroupAdminResult =
  | { ok: false; error: RequireGroupAdminError }
  | {
      ok: true;
      user: Pick<User, "id" | "email">;
      admin: AdminClient;
      group: GroupRow;
      membership: CallerMembership;
    };

export interface GroupAdminDeps {
  getUser: () => Promise<Pick<User, "id" | "email"> | null>;
  admin: AdminClient;
  findGroup: (admin: AdminClient, slug: string) => Promise<Lookup<GroupRow>>;
  findMembership: (
    admin: AdminClient,
    groupId: string,
    profileId: string,
  ) => Promise<Lookup<CallerMembership>>;
}

async function defaultGetUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Shared guard for admin-only actions: session user, group by slug, caller is
 * admin. Distinguishes "no such row" from "DB failed": a failed lookup is
 * `generic` (logged by the lookups), never `not_admin`/`group_not_found`, so a
 * blip cannot tell a real admin they lack rights. Callers map the codes to
 * their own state shape (e.g. `group_not_found` -> `not_admin` to avoid a
 * slug-existence oracle).
 */
export async function requireGroupAdmin(
  slug: string,
  deps?: Partial<GroupAdminDeps>,
): Promise<RequireGroupAdminResult> {
  const getUser = deps?.getUser ?? defaultGetUser;
  const findGroup = deps?.findGroup ?? findGroupBySlug;
  const findMembership = deps?.findMembership ?? findCallerMembership;

  const user = await getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const admin = deps?.admin ?? createAdminClient();

  const groupLookup = await findGroup(admin, slug);
  if (groupLookup.failed) return { ok: false, error: "generic" };
  const group = groupLookup.row;
  if (!group) return { ok: false, error: "group_not_found" };

  const membershipLookup = await findMembership(admin, group.id, user.id);
  if (membershipLookup.failed) return { ok: false, error: "generic" };
  const membership = membershipLookup.row;
  if (!membership || membership.role !== "admin") {
    return { ok: false, error: "not_admin" };
  }

  return { ok: true, user, admin, group, membership };
}
