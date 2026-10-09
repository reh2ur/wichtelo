import { createClient } from "@/lib/supabase/server";

export async function isSuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && user.email === process.env.SUPER_ADMIN_EMAIL;
}
