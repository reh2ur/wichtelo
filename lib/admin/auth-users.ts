import type { createAdminClient } from "@/lib/supabase/admin";

const MAX_PAGES = 20;
const PER_PAGE = 1000;

export interface AuthUserSummary {
  id: string;
  email?: string;
}

export async function listAllAuthUsers(
  admin: ReturnType<typeof createAdminClient>,
): Promise<AuthUserSummary[]> {
  const users: AuthUserSummary[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error || !data) break;
    users.push(...data.users);
    if (data.users.length < PER_PAGE) break;
  }
  return users;
}
