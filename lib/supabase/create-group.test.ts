/**
 * @integration
 *
 * Integration tests for the create_group RPC (issue #241): group + admin
 * membership + invite token in one transaction, slug retry inside it.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("create_group RPC", () => {
  let admin: ReturnType<typeof createAdminClient>;
  let userId: string;
  let noProfileId: string;
  let userEmail: string;
  let noProfileEmail: string;
  const password = "correct-horse-battery-staple-1";
  const run = Date.now();
  const blockerSlugs = [`cg-taken-${run}`, `cg-taken-${run}-2`];

  async function signedIn(email: string) {
    const client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    const { error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    admin = createAdminClient();
    userEmail = `cg-test-${run}@example.com`;
    noProfileEmail = `cg-test-noprofile-${run}@example.com`;

    const { data: u, error: uErr } = await admin.auth.admin.createUser({
      email: userEmail,
      password,
      email_confirm: true,
    });
    if (uErr) throw uErr;
    userId = u.user.id;
    await admin
      .from("profiles")
      .insert({ id: userId, first_name: "Anna", last_name: "Admin" });

    const { data: n, error: nErr } = await admin.auth.admin.createUser({
      email: noProfileEmail,
      password,
      email_confirm: true,
    });
    if (nErr) throw nErr;
    noProfileId = n.user.id;

    // Pre-existing groups that hold the first slug candidates.
    for (const slug of blockerSlugs) {
      const { error } = await admin.from("groups").insert({
        id: crypto.randomUUID(),
        slug,
        name: "Blocker",
        year: 2099,
        created_by: userId,
      });
      if (error) throw error;
    }
  });

  afterAll(async () => {
    await admin.from("groups").delete().eq("created_by", userId);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
    await admin.auth.admin.deleteUser(noProfileId);
  });

  it("creates group, admin membership and invite token together", async () => {
    const client = await signedIn(userEmail);
    const slug = `cg-ok-${run}`;
    const { data, error } = await client
      .rpc("create_group", {
        p_name: "Atomic",
        p_year: 2099,
        p_budget_hint: "20 Euro",
        p_note: null,
        p_slugs: [slug],
      })
      .single<{ group_id: string; slug: string; invite_token: string }>();
    expect(error).toBeNull();
    expect(data!.slug).toBe(slug);

    const { data: group } = await admin
      .from("groups")
      .select("created_by, state, budget_hint")
      .eq("id", data!.group_id)
      .single();
    expect(group).toEqual({
      created_by: userId,
      state: "open",
      budget_hint: "20 Euro",
    });

    const { data: members } = await admin
      .from("memberships")
      .select("profile_id, role, name_snapshot, first_name_snapshot")
      .eq("group_id", data!.group_id);
    expect(members).toEqual([
      {
        profile_id: userId,
        role: "admin",
        name_snapshot: "Anna Admin",
        first_name_snapshot: "Anna",
      },
    ]);

    const { data: tokens } = await admin
      .from("invite_tokens")
      .select("token")
      .eq("group_id", data!.group_id);
    expect(tokens).toEqual([{ token: data!.invite_token }]);
  });

  it("retries taken slugs inside the transaction", async () => {
    const client = await signedIn(userEmail);
    const free = `cg-free-${run}`;
    const { data, error } = await client
      .rpc("create_group", {
        p_name: "Retry",
        p_year: 2099,
        p_budget_hint: null,
        p_note: null,
        p_slugs: [...blockerSlugs, free],
      })
      .single<{ group_id: string; slug: string }>();
    expect(error).toBeNull();
    expect(data!.slug).toBe(free);
  });

  it("leaves no orphan group when no slug is free", async () => {
    const client = await signedIn(userEmail);
    const { count: before } = await admin
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId);
    const { error } = await client.rpc("create_group", {
      p_name: "Nope",
      p_year: 2099,
      p_budget_hint: null,
      p_note: null,
      p_slugs: blockerSlugs,
    });
    expect(error?.code).toBe("23505");
    const { count: after } = await admin
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId);
    expect(after).toBe(before);
  });

  it("creates nothing when the caller has no profile", async () => {
    const client = await signedIn(noProfileEmail);
    const slug = `cg-noprofile-${run}`;
    const { error } = await client.rpc("create_group", {
      p_name: "No profile",
      p_year: 2099,
      p_budget_hint: null,
      p_note: null,
      p_slugs: [slug],
    });
    expect(error).not.toBeNull();
    const { data } = await admin.from("groups").select("id").eq("slug", slug);
    expect(data).toEqual([]);
  });

  it("is not callable by anon", async () => {
    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    const { error } = await anon.rpc("create_group", {
      p_name: "Anon",
      p_year: 2099,
      p_budget_hint: null,
      p_note: null,
      p_slugs: [`cg-anon-${run}`],
    });
    expect(error).not.toBeNull();
  });
});
