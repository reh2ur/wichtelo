/**
 * @integration
 *
 * Password auth must be unusable (issue #15): the blank_auth_password trigger
 * wipes any password written to auth.users, so password login and public
 * password signup never yield a session.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, afterAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { signInAs } from "@/lib/supabase/test-sign-in";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

function anonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

describe.skipIf(!hasSupabase)("password auth is neutralized", () => {
  const admin = hasSupabase ? createAdminClient() : null;
  const password = "correct-horse-battery-staple-1";
  const run = Date.now();
  const userIds: string[] = [];

  afterAll(async () => {
    for (const id of userIds) await admin!.auth.admin.deleteUser(id);
  });

  it("password login fails for a user created with a password", async () => {
    const email = `pw-admin-${run}@example.com`;
    const { data, error } = await admin!.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    userIds.push(data.user!.id);

    const { data: login, error: loginError } =
      await anonClient().auth.signInWithPassword({ email, password });
    expect(loginError).not.toBeNull();
    expect(login.session).toBeNull();
  });

  it("public password signUp yields no session and no usable password", async () => {
    const email = `pw-signup-${run}@example.com`;
    const { data, error } = await anonClient().auth.signUp({
      email,
      password,
    });
    if (data.user) userIds.push(data.user.id);
    // Either rejected outright or created unconfirmed without a session.
    expect(error !== null || data.session === null).toBe(true);

    const { error: loginError } = await anonClient().auth.signInWithPassword({
      email,
      password,
    });
    expect(loginError).not.toBeNull();
  });

  it("a later password update is blanked too; OTP sign-in still works", async () => {
    const email = `pw-update-${run}@example.com`;
    const { data, error } = await admin!.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(error).toBeNull();
    userIds.push(data.user!.id);

    await admin!.auth.admin.updateUserById(data.user!.id, { password });
    const { error: loginError } = await anonClient().auth.signInWithPassword({
      email,
      password,
    });
    expect(loginError).not.toBeNull();

    const { error: otpError } = await signInAs(anonClient(), email);
    expect(otpError).toBeNull();
  });
});
