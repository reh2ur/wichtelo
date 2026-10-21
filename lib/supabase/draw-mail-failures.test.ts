/**
 * @integration
 *
 * draw_mail_failures table + record_draw_mail_result RPC (issue #106):
 * admin-only read via RLS, no user-JWT writes, version-guarded upsert/clear,
 * cascade on group delete. Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { signInAs } from "@/lib/supabase/test-sign-in";
import { fetchDrawMailWarning } from "@/lib/draw-mail-status";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("draw_mail_failures (#106)", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  const stamp = Date.now();
  let groupId: string;
  let adminUserId: string;
  let memberUserId: string;
  const adminEmail = `dmf-admin-${stamp}@example.com`;
  const memberEmail = `dmf-member-${stamp}@example.com`;

  function userClient() {
    return createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
  }

  async function row() {
    const { data } = await admin
      .from("draw_mail_failures")
      .select("draw_version, failed, total")
      .eq("group_id", groupId)
      .maybeSingle();
    return data;
  }

  const record = (version: number, failed: number, total: number) =>
    admin.rpc("record_draw_mail_result", {
      p_group_id: groupId,
      p_draw_version: version,
      p_failed: failed,
      p_total: total,
    });

  beforeAll(async () => {
    const mk = async (email: string, first: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (error) throw error;
      await admin
        .from("profiles")
        .insert({ id: data.user.id, first_name: first, last_name: "Test" });
      return data.user.id;
    };
    adminUserId = await mk(adminEmail, "Admin");
    memberUserId = await mk(memberEmail, "Member");

    groupId = crypto.randomUUID();
    const { error } = await admin.from("groups").insert({
      id: groupId,
      name: "DMF Gruppe",
      slug: `dmf-${stamp}`,
      year: 2099,
      state: "open",
      created_by: adminUserId,
    });
    if (error) throw error;
    await admin.from("memberships").insert([
      {
        group_id: groupId,
        profile_id: adminUserId,
        name_snapshot: "Admin Test",
        role: "admin",
      },
      {
        group_id: groupId,
        profile_id: memberUserId,
        name_snapshot: "Member Test",
        role: "participant",
      },
    ]);
  });

  afterAll(async () => {
    await admin.from("groups").delete().eq("id", groupId);
    await admin.from("profiles").delete().in("id", [adminUserId, memberUserId]);
    await admin.auth.admin.deleteUser(adminUserId);
    await admin.auth.admin.deleteUser(memberUserId);
  });

  it("upserts a failure and clears it on a clean send", async () => {
    expect((await record(1, 1, 3)).error).toBeNull();
    expect(await row()).toEqual({ draw_version: 1, failed: 1, total: 3 });

    // Resend still partially failing: counts replaced, not duplicated.
    await record(1, 2, 3);
    expect(await row()).toEqual({ draw_version: 1, failed: 2, total: 3 });

    // Successful resend clears.
    await record(1, 0, 3);
    expect(await row()).toBeNull();
  });

  it("re-draw replaces the row; a stale send of the old draw cannot clobber it", async () => {
    await record(1, 1, 3);
    await record(2, 2, 4);
    expect(await row()).toEqual({ draw_version: 2, failed: 2, total: 4 });

    // Slow resend of draw 1 finishes after the re-draw.
    await record(1, 1, 3);
    expect(await row()).toEqual({ draw_version: 2, failed: 2, total: 4 });
    await record(1, 0, 3);
    expect(await row()).toEqual({ draw_version: 2, failed: 2, total: 4 });

    // Clean re-draw (version 3) resets.
    await record(3, 0, 4);
    expect(await row()).toBeNull();
  });

  it("does nothing for an unknown group", async () => {
    const { error } = await admin.rpc("record_draw_mail_result", {
      p_group_id: crypto.randomUUID(),
      p_draw_version: 1,
      p_failed: 1,
      p_total: 3,
    });
    expect(error).toBeNull();
  });

  it("group admin reads the row; participant and anon do not", async () => {
    await record(1, 1, 3);
    // Align the group's draw_version with the stored row.
    await admin.from("groups").update({ draw_version: 1 }).eq("id", groupId);

    const adminClient = userClient();
    await signInAs(adminClient, adminEmail);
    expect(await fetchDrawMailWarning(adminClient, groupId)).toEqual({
      failed: 1,
      total: 3,
    });

    const memberClient = userClient();
    await signInAs(memberClient, memberEmail);
    const { data: memberRows } = await memberClient
      .from("draw_mail_failures")
      .select("failed")
      .eq("group_id", groupId);
    expect(memberRows).toEqual([]);
    expect(await fetchDrawMailWarning(memberClient, groupId)).toBeNull();

    const { data: anonRows } = await userClient()
      .from("draw_mail_failures")
      .select("failed")
      .eq("group_id", groupId);
    expect(anonRows ?? []).toEqual([]);
  });

  it("a re-draw (draw_version bump) hides the stale row from the admin", async () => {
    await admin.from("groups").update({ draw_version: 2 }).eq("id", groupId);
    const adminClient = userClient();
    await signInAs(adminClient, adminEmail);
    expect(await fetchDrawMailWarning(adminClient, groupId)).toBeNull();
  });

  it("user JWT cannot write the table or call the RPC", async () => {
    const adminClient = userClient();
    await signInAs(adminClient, adminEmail);

    const { error: insertError } = await adminClient
      .from("draw_mail_failures")
      .insert({ group_id: groupId, draw_version: 9, failed: 1, total: 1 });
    expect(insertError).not.toBeNull();

    const { error: deleteError } = await adminClient
      .from("draw_mail_failures")
      .delete()
      .eq("group_id", groupId);
    expect(deleteError).not.toBeNull();

    const { error: rpcError } = await adminClient.rpc(
      "record_draw_mail_result",
      {
        p_group_id: groupId,
        p_draw_version: 9,
        p_failed: 0,
        p_total: 0,
      },
    );
    expect(rpcError).not.toBeNull();
    expect(await row()).toEqual({ draw_version: 1, failed: 1, total: 3 });
  });

  it("row cascades away with the group", async () => {
    const otherId = crypto.randomUUID();
    await admin.from("groups").insert({
      id: otherId,
      name: "DMF Cascade",
      slug: `dmf-cascade-${stamp}`,
      year: 2099,
      state: "open",
      created_by: adminUserId,
    });
    await admin.rpc("record_draw_mail_result", {
      p_group_id: otherId,
      p_draw_version: 1,
      p_failed: 1,
      p_total: 2,
    });
    await admin.from("groups").delete().eq("id", otherId);
    const { data } = await admin
      .from("draw_mail_failures")
      .select("group_id")
      .eq("group_id", otherId);
    expect(data).toEqual([]);
  });
});
