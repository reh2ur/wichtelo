"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/anmelden");
}

/** Sign out and return to the invite page so another account can be used. */
export async function signOutToInvite(token: string): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/einladung/${encodeURIComponent(token)}`);
}
