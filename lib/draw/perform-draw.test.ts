/**
 * @integration
 *
 * Integration tests for the perform_draw RPC + join guard
 * (supabase/migrations/20261007190000_atomic_draw.sql).
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("perform_draw", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  let userId: string;
  const extraUserIds: string[] = [];
  let groupId: string;
  let memberIds: string[] = [];

  const rotate = (shift: number) =>
    memberIds.map((giver, i) => ({
      group_id: groupId,
      giver_id: giver,
      receiver_id: memberIds[(i + shift) % memberIds.length],
    }));

  const draw = (pairs: unknown, state = "open", version = 0) =>
    admin.rpc("perform_draw", {
      p_group_id: groupId,
      p_pairs: pairs,
      p_expected_state: state,
      p_expected_version: version,
    });

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `perform-draw-${Date.now()}@example.com`,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    await admin
      .from("profiles")
      .insert({ id: userId, first_name: "Draw", last_name: "Admin" });
    groupId = crypto.randomUUID();
    await admin.from("groups").insert({
      id: groupId,
      name: "Draw Test",
      slug: `perform-draw-${Date.now()}`,
      year: 2099,
      created_by: userId,
    });
    // Open-group members need live profiles: profile_id NULL = ghost (#244).
    const profileIds = [userId];
    for (const n of ["B", "C"]) {
      const { data: u, error: uErr } = await admin.auth.admin.createUser({
        email: `perform-draw-${n}-${Date.now()}@example.com`,
        email_confirm: true,
      });
      if (uErr) throw uErr;
      extraUserIds.push(u.user.id);
      await admin
        .from("profiles")
        .insert({ id: u.user.id, first_name: n, last_name: "Member" });
      profileIds.push(u.user.id);
    }
    const { data: members, error: mErr } = await admin
      .from("memberships")
      .insert(
        ["A", "B", "C"].map((n, i) => ({
          group_id: groupId,
          profile_id: profileIds[i],
          name_snapshot: n,
        })),
      )
      .select("id");
    if (mErr) throw mErr;
    memberIds = members!.map((m) => m.id as string);
  });

  afterAll(async () => {
    await admin.from("groups").delete().eq("id", groupId);
    await admin.auth.admin.deleteUser(userId);
    for (const id of extraUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("rejects a draw of an open group containing a ghost member", async () => {
    const { data: ghost, error } = await admin
      .from("memberships")
      .insert({ group_id: groupId, name_snapshot: "Ghost" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const ids = [...memberIds, ghost!.id as string];
    const pairs = ids.map((giver, i) => ({
      group_id: groupId,
      giver_id: giver,
      receiver_id: ids[(i + 1) % ids.length],
    }));
    const { data } = await draw(pairs);
    expect(data).toBe("ghost_members");
    const { data: group } = await admin
      .from("groups")
      .select("state")
      .eq("id", groupId)
      .single();
    expect(group!.state).toBe("open");
    await admin.from("memberships").delete().eq("id", ghost!.id);
  });

  it("lets exactly one of two parallel draws win", async () => {
    const results = await Promise.all([draw(rotate(1)), draw(rotate(2))]);
    const values = results.map((r) => r.data).sort();
    expect(values).toEqual(["ok", "state_changed"]);

    const { data: group } = await admin
      .from("groups")
      .select("state, draw_version")
      .eq("id", groupId)
      .single();
    expect(group).toMatchObject({ state: "drawn", draw_version: 1 });
    const { count } = await admin
      .from("assignments")
      .select("*", { count: "exact", head: true })
      .eq("group_id", groupId);
    expect(count).toBe(3);
  });

  it("lets only one of two parallel re-draws win", async () => {
    const results = await Promise.all([
      draw(rotate(1), "drawn", 1),
      draw(rotate(2), "drawn", 1),
    ]);
    expect(results.map((r) => r.data).sort()).toEqual(["ok", "state_changed"]);
  });

  it("keeps old assignments when the insert fails", async () => {
    const { data: before } = await admin
      .from("assignments")
      .select("giver_id, receiver_id")
      .eq("group_id", groupId);
    const { data: group } = await admin
      .from("groups")
      .select("draw_version")
      .eq("id", groupId)
      .single();
    const bad = rotate(1).map((p) => ({ ...p, receiver_id: memberIds[0] }));
    const { error } = await draw(bad, "drawn", group!.draw_version);
    expect(error).not.toBeNull();
    const { data: after } = await admin
      .from("assignments")
      .select("giver_id, receiver_id")
      .eq("group_id", groupId);
    expect(after).toHaveLength(3);
    expect(new Set(after!.map((a) => a.receiver_id + a.giver_id))).toEqual(
      new Set(before!.map((a) => a.receiver_id + a.giver_id)),
    );
  });

  it("rejects a draw when membership changed", async () => {
    const { data: group } = await admin
      .from("groups")
      .select("draw_version")
      .eq("id", groupId)
      .single();
    const { data } = await draw(
      rotate(1).slice(0, 2),
      "drawn",
      group!.draw_version,
    );
    expect(data).toBe("membership_changed");
  });

  it("rejects joins into a drawn group", async () => {
    const { error } = await admin
      .from("memberships")
      .insert({ group_id: groupId, name_snapshot: "Late" });
    expect(error?.message).toContain("already drawn");
  });
});

describe.skipIf(!hasSupabase)(
  "perform_draw re-draw with ghost members (#18)",
  () => {
    const admin = hasSupabase ? createAdminClient() : (null as never);
    const userIds: string[] = [];
    let groupId: string;
    let memberIds: string[] = []; // [live1, live2, live3, ghost-to-be]

    const draw = (ids: string[], state: string, version: number) =>
      admin.rpc("perform_draw", {
        p_group_id: groupId,
        p_pairs: ids.map((giver, i) => ({
          group_id: groupId,
          giver_id: giver,
          receiver_id: ids[(i + 1) % ids.length],
        })),
        p_expected_state: state,
        p_expected_version: version,
      });

    beforeAll(async () => {
      const run = Date.now();
      for (const n of ["1", "2", "3", "4"]) {
        const { data, error } = await admin.auth.admin.createUser({
          email: `perform-draw-ghost-${n}-${run}@example.com`,
          email_confirm: true,
        });
        if (error) throw error;
        userIds.push(data.user.id);
        await admin
          .from("profiles")
          .insert({ id: data.user.id, first_name: n, last_name: "Ghost" });
      }
      groupId = crypto.randomUUID();
      const { error: gErr } = await admin.from("groups").insert({
        id: groupId,
        name: "Ghost Draw Test",
        slug: `perform-draw-ghost-${run}`,
        year: 2099,
        created_by: userIds[0],
      });
      if (gErr) throw gErr;
      const { data: members, error: mErr } = await admin
        .from("memberships")
        .insert(
          userIds.map((id, i) => ({
            group_id: groupId,
            profile_id: id,
            name_snapshot: `M${i}`,
          })),
        )
        .select("id, name_snapshot");
      if (mErr) throw mErr;
      memberIds = ["M0", "M1", "M2", "M3"].map(
        (n) => members!.find((m) => m.name_snapshot === n)!.id as string,
      );
      const { data: first } = await draw(memberIds, "open", 0);
      expect(first).toBe("ok");
      // Account deletion after the draw: profile cascades, membership is nulled.
      await admin.auth.admin.deleteUser(userIds[3]);
    });

    afterAll(async () => {
      await admin.from("groups").delete().eq("id", groupId);
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    });

    it("keeps the nulled membership after the account is deleted", async () => {
      const { data } = await admin
        .from("memberships")
        .select("profile_id")
        .eq("id", memberIds[3])
        .single();
      expect(data!.profile_id).toBeNull();
    });

    it("rejects a re-draw that still includes the ghost and keeps its row", async () => {
      const { data } = await draw(memberIds, "drawn", 1);
      expect(data).toBe("membership_changed");
      const { data: ghost } = await admin
        .from("memberships")
        .select("id")
        .eq("id", memberIds[3]);
      expect(ghost).toHaveLength(1);
    });

    it("re-draws live members only and removes the ghost atomically", async () => {
      const { data } = await draw(memberIds.slice(0, 3), "drawn", 1);
      expect(data).toBe("ok");

      const { data: ghost } = await admin
        .from("memberships")
        .select("id")
        .eq("id", memberIds[3]);
      expect(ghost).toHaveLength(0);

      const { data: rows } = await admin
        .from("assignments")
        .select("giver_id, receiver_id")
        .eq("group_id", groupId);
      expect(rows).toHaveLength(3);
      for (const r of rows!) {
        expect(memberIds.slice(0, 3)).toContain(r.giver_id);
        expect(memberIds.slice(0, 3)).toContain(r.receiver_id);
      }
      const { data: group } = await admin
        .from("groups")
        .select("state, draw_version")
        .eq("id", groupId)
        .single();
      expect(group).toMatchObject({ state: "drawn", draw_version: 2 });
    });

    it("plain membership deletes stay blocked after the re-draw", async () => {
      const { error } = await admin
        .from("memberships")
        .delete()
        .eq("id", memberIds[0]);
      expect(error?.message).toContain("already drawn");
    });
  },
);
