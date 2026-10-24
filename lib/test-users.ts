import type { SupabaseClient, User } from "@supabase/supabase-js";

const PER_PAGE = 1000;

/**
 * Pages through all auth users (E2E backdoors only). listUsers caps one page
 * at `perPage`, so a single call silently misses everything beyond it.
 */
export async function listAllUsers(admin: SupabaseClient): Promise<User[]> {
  const all: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < PER_PAGE) return all;
  }
}

/** Pages until the email is found; stops early instead of loading everything. */
export async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < PER_PAGE) return null;
  }
}
