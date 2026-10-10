import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Integration-test helper: signs `client` in as an existing user via the same
 * email-OTP path the app uses. Password auth is neutralized at the DB level
 * (`blank_auth_password` trigger), so tests can't log in with a password.
 */
export async function signInAs(client: SupabaseClient, email: string) {
  const { data, error: linkError } =
    await createAdminClient().auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkError || !data.properties?.email_otp) {
    return { error: linkError ?? new Error("generateLink returned no OTP") };
  }
  return client.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: "email",
  });
}
