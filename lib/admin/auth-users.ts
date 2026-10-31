import type { User } from "@supabase/supabase-js";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const PER_PAGE = 1000;

export type AuthUserSummary = Pick<
  User,
  | "id"
  | "email"
  | "created_at"
  | "last_sign_in_at"
  | "banned_until"
  | "app_metadata"
>;

/**
 * Pages through every auth user until a short page. Throws on any API error:
 * a failed listing must surface as an error page, never as "0 users" or a
 * silently truncated list.
 */
export async function listAllAuthUsers(
  admin: AdminClient,
): Promise<AuthUserSummary[]> {
  const users: AuthUserSummary[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) {
      throw new Error(
        `[listAllAuthUsers] page ${page} failed: ${error.message}`,
      );
    }
    users.push(...data.users);
    if (data.users.length < PER_PAGE) return users;
  }
}

/**
 * Looks up the given auth users by id (parallel `getUserById`), so callers
 * that need a handful of users do not list the whole user table. Unknown ids
 * map to `null` (deleted accounts); any other error throws.
 */
export async function getAuthUsersById(
  admin: AdminClient,
  ids: Iterable<string>,
): Promise<Map<string, AuthUserSummary | null>> {
  const unique = [...new Set(ids)];
  const entries = await Promise.all(
    unique.map(async (id): Promise<[string, AuthUserSummary | null]> => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) {
        if (error.status === 404) return [id, null];
        throw new Error(`[getAuthUsersById] ${id} failed: ${error.message}`);
      }
      return [id, data?.user ?? null];
    }),
  );
  return new Map(entries);
}
