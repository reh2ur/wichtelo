import { createClient } from "@/lib/supabase/server";

/** Signed-in user of the current request (id + email), or null. */
export async function getSessionUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}

/** True when `userId` is the caller (super-admins must not ban/delete themselves). */
export async function isSelf(userId: string): Promise<boolean> {
  const user = await getSessionUser();
  return user?.id === userId;
}
