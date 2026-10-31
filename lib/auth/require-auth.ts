import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "./get-user";

export async function requireAuth(): Promise<void> {
  const supabase = await createClient();

  // Fast path: local JWT check, no network call
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/anmelden");

  // Authoritative check: catches revoked/deleted sessions
  const user = await getUser();
  if (!user) redirect("/anmelden");
}

/**
 * Authoritative user for pages behind the proxy auth gate. Redirects instead
 * of returning null: a session revoked between proxy and render must not
 * surface as a TypeError.
 */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/anmelden");
  return user;
}
