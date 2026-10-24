import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Self-signup is disabled in Supabase Auth (`enable_signup = false`), so the
 * publishable key alone cannot create accounts. The server creates them here
 * instead, only after it validated an invite token (or the super-admin email).
 * Idempotent: an already-registered address is fine. Throws on any other error.
 */
export async function ensureAuthUser(
  admin: AdminClient,
  email: string,
): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (!error) return;
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return;
  }
  throw new Error(`ensureAuthUser failed: ${error.message}`);
}
