import { createClient } from "@/lib/supabase/server";
import { isSuperAdminEmail } from "@/lib/admin/super-admin-email";

export async function isSuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && isSuperAdminEmail(user.email);
}
