/**
 * @integration
 *
 * Wishes (#208) and account removal: wishes belong to the account, so
 * `deleteAccount` removes them (FK cascade profile → wishes) — also when a
 * wish is linked to a drawn group whose membership is ghosted first. Wishes of
 * OTHER users in the same group stay untouched. Requires local Supabase.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAccount } from "./index";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("deleteAccount: wishes", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  const stamp = Date.now();
  let leaverId: string;
  let stayerId: string;
  let groupId: string;
  let stayerWishId: string;

  async function mkUser(label: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `wish-del-${label}-${stamp}@test.local`,
      email_confirm: true,
    });
    if (error) throw error;
    const { error: pe } = await admin
      .from("profiles")
      .insert({ id: data.user.id, first_name: label, last_name: "Wish" });
    if (pe) throw pe;
    return data.user.id;
  }

  beforeAll(async () => {
    leaverId = await mkUser("leaver");
    stayerId = await mkUser("stayer");

    const { data: group, error } = await admin
      .from("groups")
      .insert({
        slug: `wish-del-${stamp}`,
        name: "Wish Del",
        year: 2099,
        created_by: stayerId,
      })
      .select("id")
      .single();
    if (error) throw error;
    groupId = group.id;
    for (const [id, role] of [
      [stayerId, "admin"],
      [leaverId, "participant"],
    ] as const) {
      const { error: me } = await admin.from("memberships").insert({
        group_id: groupId,
        profile_id: id,
        name_snapshot: "Wish Member",
        role,
      });
      if (me) throw me;
    }

    const { error: we } = await admin.from("wishes").insert([
      // Bulk insert sends explicit null for keys missing in a row (no column
      // default) → set status on every row.
      {
        profile_id: leaverId,
        title: "leaver open",
        group_id: groupId,
        status: "open",
      },
      { profile_id: leaverId, title: "leaver unassigned", status: "open" },
      {
        profile_id: leaverId,
        title: "leaver archived",
        status: "received",
        received_at: new Date().toISOString(),
      },
    ]);
    if (we) throw we;
    const { data: sw, error: swe } = await admin
      .from("wishes")
      .insert({ profile_id: stayerId, title: "stayer", group_id: groupId })
      .select("id")
      .single();
    if (swe) throw swe;
    stayerWishId = sw.id;

    // Drawn group: the leaver's membership is ghosted, not deleted.
    await admin.from("groups").update({ state: "drawn" }).eq("id", groupId);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("groups").delete().eq("id", groupId);
    await admin.auth.admin.deleteUser(stayerId);
    await admin.auth.admin.deleteUser(leaverId).catch(() => {});
  });

  it("removes all wishes of the deleted account, keeps other users' wishes", async () => {
    await deleteAccount(leaverId);

    const { data: gone, error } = await admin
      .from("wishes")
      .select("id")
      .eq("profile_id", leaverId);
    expect(error).toBeNull();
    expect(gone).toEqual([]);

    const { data: kept } = await admin
      .from("wishes")
      .select("id, group_id")
      .eq("id", stayerWishId)
      .single();
    expect(kept).toEqual({ id: stayerWishId, group_id: groupId });
  });
});
