/**
 * @integration
 *
 * Self-signup must be off (issue #130): the public publishable key alone can
 * not create accounts, only the server (admin API) can, after validating an
 * invite / the super-admin email.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, afterAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAuthUser } from "@/lib/supabase/ensure-auth-user";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

function anonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

describe.skipIf(!hasSupabase)("self-signup is disabled", () => {
  const admin = hasSupabase ? createAdminClient() : null;
  const run = Date.now();
  const created: string[] = [];

  async function findUserId(email: string): Promise<string | null> {
    const { data } = await admin!.auth.admin.listUsers({ perPage: 1000 });
    return data.users.find((u) => u.email === email)?.id ?? null;
  }

  afterAll(async () => {
    for (const id of created) await admin!.auth.admin.deleteUser(id);
  });

  it("signInWithOtp({ shouldCreateUser: true }) with the publishable key fails and creates no user", async () => {
    const email = `signup-otp-${run}@example.com`;
    const { error } = await anonClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    expect(error).not.toBeNull();
    const id = await findUserId(email);
    if (id) created.push(id);
    expect(id).toBeNull();
  });

  it("password signUp with the publishable key fails and creates no user", async () => {
    const email = `signup-pw-${run}@example.com`;
    const { error } = await anonClient().auth.signUp({
      email,
      password: "correct-horse-battery-staple-1",
    });
    expect(error).not.toBeNull();
    const id = await findUserId(email);
    if (id) created.push(id);
    expect(id).toBeNull();
  });

  it("ensureAuthUser creates a confirmed user server-side and is idempotent", async () => {
    const email = `signup-ensure-${run}@example.com`;
    await ensureAuthUser(admin!, email);
    const id = await findUserId(email);
    expect(id).not.toBeNull();
    if (id) created.push(id);

    await expect(ensureAuthUser(admin!, email)).resolves.toBeUndefined();
  });

  it("admin generateLink (OTP) still works for an ensured user", async () => {
    const email = `signup-known-${run}@example.com`;
    await ensureAuthUser(admin!, email);
    const id = await findUserId(email);
    if (id) created.push(id);
    const { error } = await admin!.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    expect(error).toBeNull();
  });
});
