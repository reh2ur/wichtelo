/**
 * @integration
 *
 * Concurrency tests (#147): membership removal and joins must serialize with
 * perform_draw on the group row lock. Uses a real Postgres transaction (pg)
 * to hold one side in flight while the other runs through PostgREST, so the
 * interleaving is deterministic instead of a timing race.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeMembership } from "./index";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
const dbUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves "pending" if `p` has not settled within `ms`. */
async function settledWithin<T>(p: Promise<T>, ms: number) {
  const marker = Symbol("pending");
  const r = await Promise.race([p, sleep(ms).then(() => marker)]);
  return r === marker ? ("pending" as const) : { value: r as T };
}

describe.skipIf(!hasSupabase)("membership vs draw interleavings", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  const run = Date.now();
  const userIds: string[] = [];
  const groupIds: string[] = [];
  let pg: Client;

  const rotate = (ids: string[], shift = 1) =>
    ids.map((giver, i) => ({
      giver_id: giver,
      receiver_id: ids[(i + shift) % ids.length],
    }));

  /** Open group with the first `n` users as live members (user 0 = admin). */
  async function makeGroup(label: string, n = 4) {
    const id = crypto.randomUUID();
    groupIds.push(id);
    const { error: gErr } = await admin.from("groups").insert({
      id,
      name: `Interleave ${label}`,
      slug: `interleave-${label}-${run}`,
      year: 2099,
      created_by: userIds[0],
    });
    if (gErr) throw gErr;
    const { data, error } = await admin
      .from("memberships")
      .insert(
        userIds.slice(0, n).map((uid, i) => ({
          group_id: id,
          profile_id: uid,
          name_snapshot: `M${i}`,
          role: i === 0 ? "admin" : "participant",
        })),
      )
      .select("id, profile_id");
    if (error) throw error;
    const memberIds = userIds
      .slice(0, n)
      .map((uid) => data!.find((m) => m.profile_id === uid)!.id as string);
    return { groupId: id, memberIds };
  }

  const groupRow = async (id: string) =>
    (
      await admin
        .from("groups")
        .select("state, draw_version")
        .eq("id", id)
        .single()
    ).data!;

  const memberExists = async (id: string) =>
    ((await admin.from("memberships").select("id").eq("id", id)).data ?? [])
      .length === 1;

  beforeAll(async () => {
    for (const n of ["A", "B", "C", "D", "E"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `interleave-${n}-${run}@example.com`,
        email_confirm: true,
      });
      if (error) throw error;
      userIds.push(data.user.id);
      await admin
        .from("profiles")
        .insert({ id: data.user.id, first_name: n, last_name: "Interleave" });
    }
    pg = new Client({ connectionString: dbUrl });
    await pg.connect();
  });

  afterAll(async () => {
    await pg?.query("rollback").catch(() => {});
    await pg?.end();
    for (const id of groupIds) await admin.from("groups").delete().eq("id", id);
    await admin.from("profiles").delete().in("id", userIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("remove_membership waits for an in-flight draw, then reports already_drawn", async () => {
    const { groupId, memberIds } = await makeGroup("rm-after-draw");
    const victim = memberIds[3];

    await pg.query("begin");
    try {
      const { rows } = await pg.query(
        "select public.perform_draw($1, $2::jsonb, 'open', 0) as r",
        [groupId, JSON.stringify(rotate(memberIds))],
      );
      expect(rows[0].r).toBe("ok");

      const removal = removeMembership(admin, groupId, victim);
      expect(await settledWithin(removal, 700)).toBe("pending");

      await pg.query("commit");
      expect(await removal).toEqual({ result: "already_drawn" });
    } finally {
      await pg.query("rollback").catch(() => {});
    }
    // Nobody lost a gift: member and all 4 assignments survive.
    expect(await memberExists(victim)).toBe(true);
    const { count } = await admin
      .from("assignments")
      .select("*", { count: "exact", head: true })
      .eq("group_id", groupId);
    expect(count).toBe(4);
  });

  it("a draw waits for an in-flight removal and then rejects its stale member snapshot", async () => {
    const { groupId, memberIds } = await makeGroup("draw-after-rm");
    const victim = memberIds[3];
    const staleSnapshot = rotate(memberIds);

    await pg.query("begin");
    try {
      const { rows } = await pg.query(
        "select public.remove_membership($1, $2, false, true) as r",
        [groupId, victim],
      );
      expect(rows[0].r).toBe("ok");

      const drawPromise = Promise.resolve(
        admin.rpc("perform_draw", {
          p_group_id: groupId,
          p_pairs: staleSnapshot,
          p_expected_state: "open",
          p_expected_version: 0,
        }),
      );
      expect(await settledWithin(drawPromise, 700)).toBe("pending");

      await pg.query("commit");
      const { data } = await drawPromise;
      expect(data).toBe("membership_changed");
    } finally {
      await pg.query("rollback").catch(() => {});
    }
    expect(await memberExists(victim)).toBe(false);
    expect(await groupRow(groupId)).toMatchObject({
      state: "open",
      draw_version: 0,
    });
  });

  it("a join waits for an in-flight draw and is rejected once the group is drawn", async () => {
    const { groupId, memberIds } = await makeGroup("join-after-draw");

    await pg.query("begin");
    try {
      const { rows } = await pg.query(
        "select public.perform_draw($1, $2::jsonb, 'open', 0) as r",
        [groupId, JSON.stringify(rotate(memberIds))],
      );
      expect(rows[0].r).toBe("ok");

      const join = Promise.resolve(
        admin.from("memberships").insert({
          group_id: groupId,
          profile_id: userIds[4],
          name_snapshot: "Late",
        }),
      );
      expect(await settledWithin(join, 700)).toBe("pending");

      await pg.query("commit");
      const { error } = await join;
      expect(error?.message).toContain("already drawn");
    } finally {
      await pg.query("rollback").catch(() => {});
    }
    const { data } = await admin
      .from("memberships")
      .select("id")
      .eq("group_id", groupId)
      .eq("profile_id", userIds[4]);
    expect(data).toHaveLength(0);
  });

  it("a draw waits for an in-flight join and rejects the snapshot that misses the joiner", async () => {
    const { groupId, memberIds } = await makeGroup("draw-after-join");

    await pg.query("begin");
    try {
      await pg.query(
        `insert into public.memberships (group_id, profile_id, name_snapshot)
         values ($1, $2, 'Joiner')`,
        [groupId, userIds[4]],
      );

      const drawPromise = Promise.resolve(
        admin.rpc("perform_draw", {
          p_group_id: groupId,
          p_pairs: rotate(memberIds),
          p_expected_state: "open",
          p_expected_version: 0,
        }),
      );
      // The join's FOR SHARE on the group row conflicts with the draw's lock.
      expect(await settledWithin(drawPromise, 700)).toBe("pending");

      await pg.query("commit");
      const { data } = await drawPromise;
      expect(data).toBe("membership_changed");
    } finally {
      await pg.query("rollback").catch(() => {});
    }
    expect(await groupRow(groupId)).toMatchObject({
      state: "open",
      draw_version: 0,
    });
    const { count } = await admin
      .from("assignments")
      .select("*", { count: "exact", head: true })
      .eq("group_id", groupId);
    expect(count).toBe(0);
  });

  it("a plain removal racing a draw in parallel never leaves a drawn group short a member", async () => {
    const { groupId, memberIds } = await makeGroup("parallel");
    const victim = memberIds[3];

    const [removal, draw] = await Promise.all([
      removeMembership(admin, groupId, victim),
      Promise.resolve(
        admin.rpc("perform_draw", {
          p_group_id: groupId,
          p_pairs: rotate(memberIds),
          p_expected_state: "open",
          p_expected_version: 0,
        }),
      ),
    ]);

    // Exactly one side wins; the loser sees the winner's state.
    if (removal.result === "ok") {
      expect(draw.data).toBe("membership_changed");
      expect((await groupRow(groupId)).state).toBe("open");
    } else {
      expect(removal.result).toBe("already_drawn");
      expect(draw.data).toBe("ok");
      expect(await memberExists(victim)).toBe(true);
    }
  });

  it("admin removal after the draw (allowDrawn) cascades the member's assignments", async () => {
    const { groupId, memberIds } = await makeGroup("allow-drawn");
    const { data: drawn } = await admin.rpc("perform_draw", {
      p_group_id: groupId,
      p_pairs: rotate(memberIds),
      p_expected_state: "open",
      p_expected_version: 0,
    });
    expect(drawn).toBe("ok");

    const victim = memberIds[3];
    expect(
      await removeMembership(admin, groupId, victim, { allowDrawn: true }),
    ).toEqual({ result: "ok" });
    const { data } = await admin
      .from("assignments")
      .select("giver_id, receiver_id")
      .eq("group_id", groupId);
    expect(data).toHaveLength(2);
    for (const a of data!) {
      expect(a.giver_id).not.toBe(victim);
      expect(a.receiver_id).not.toBe(victim);
    }
  });

  it("refuses to remove the last live admin and unknown members", async () => {
    const { groupId, memberIds } = await makeGroup("guards");
    expect(await removeMembership(admin, groupId, memberIds[0])).toEqual({
      result: "last_admin",
    });
    expect(await removeMembership(admin, groupId, crypto.randomUUID())).toEqual(
      { result: "member_not_found" },
    );
    expect(
      await removeMembership(admin, crypto.randomUUID(), memberIds[1]),
    ).toEqual({ result: "group_not_found" });
    expect(await memberExists(memberIds[0])).toBe(true);
  });
});
