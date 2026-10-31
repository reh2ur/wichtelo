/**
 * @integration
 *
 * Concurrency tests for #105: account deletion on a drawn group must take the
 * same group-row lock as perform_draw, so a re-draw and the membership nulling
 * never run against the same stale member snapshot. Uses two real Postgres
 * transactions (pg) because PostgREST cannot hold a transaction open.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
const dbUrl =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Polls pg_stat_activity until a backend running a statement that mentions
 * `fn` is blocked on a lock (wait_event_type = 'Lock', i.e. a pg_locks row
 * with granted = false). Deterministic replacement for fixed sleeps: proves
 * the call is really queued behind our open transaction.
 */
async function waitUntilBlocked(pg: Client, fn: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pg.query(
      `select 1 from pg_stat_activity a
        where a.pid <> pg_backend_pid()
          and a.wait_event_type = 'Lock'
          and a.query ilike $1
          and exists (select 1 from pg_locks l
                       where l.pid = a.pid and not l.granted)`,
      [`%${fn}%`],
    );
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no backend blocked on a lock while running ${fn}`);
}

/** Tracks whether `p` has settled, without awaiting it. */
function track<T>(p: PromiseLike<T>) {
  const state = { settled: false };
  const promise = Promise.resolve(p).finally(() => {
    state.settled = true;
  });
  return { state, promise };
}

describe.skipIf(!hasSupabase)("ghost_drawn_memberships vs perform_draw", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  const run = Date.now();
  const userIds: string[] = [];
  let groupId: string;
  let memberIds: string[] = [];
  let version = 0;
  let pg: Client;

  const rotate = (ids: string[], shift = 1) =>
    ids.map((giver, i) => ({
      giver_id: giver,
      receiver_id: ids[(i + shift) % ids.length],
    }));

  const redraw = (pairs: Json) =>
    admin.rpc("perform_draw", {
      p_group_id: groupId,
      p_pairs: pairs,
      p_expected_state: "drawn",
      p_expected_version: version,
    });

  const memberProfile = async (id: string) =>
    (await admin.from("memberships").select("profile_id").eq("id", id).single())
      .data?.profile_id as string | null;

  beforeAll(async () => {
    for (const n of ["A", "B", "C", "D"]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `ghost-lock-${n}-${run}@example.com`,
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
      name: "Ghost Lock",
      slug: `ghost-lock-${run}`,
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
      .select("id, profile_id");
    if (mErr) throw mErr;
    // Keep ids aligned with userIds order.
    memberIds = userIds.map(
      (uid) => members!.find((m) => m.profile_id === uid)!.id as string,
    );
    const { data: first } = await admin.rpc("perform_draw", {
      p_group_id: groupId,
      p_pairs: rotate(memberIds),
      p_expected_state: "open",
      p_expected_version: 0,
    });
    expect(first).toBe("ok");
    version = 1;

    pg = new Client({ connectionString: dbUrl });
    await pg.connect();
  });

  afterAll(async () => {
    await pg?.query("rollback").catch(() => {});
    await pg?.end();
    await admin.from("groups").delete().eq("id", groupId);
    await admin.from("profiles").delete().in("id", userIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("perform_draw is hardened with an empty search_path (#111)", async () => {
    const { rows } = await pg.query(
      `select proname, proconfig from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('perform_draw', 'ghost_drawn_memberships')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.proconfig, row.proname).toContain('search_path=""');
    }
  });

  it("re-draw waits for an in-flight account deletion, then sees the changed members", async () => {
    // Re-draw is built from the snapshot taken BEFORE the deletion.
    const staleSnapshot = rotate(memberIds, 2);
    const victim = memberIds[3];

    await pg.query("begin");
    try {
      const { rows } = await pg.query(
        "select public.ghost_drawn_memberships($1) as n",
        [userIds[3]],
      );
      expect(rows[0].n).toBe(1);

      const { state, promise: drawPromise } = track(redraw(staleSnapshot));
      // Blocked on the group row lock held by the deletion transaction.
      await waitUntilBlocked(pg, "perform_draw");
      expect(state.settled).toBe(false);

      await pg.query("commit");
      const { data } = await drawPromise;
      // Member was nulled first, so the stale snapshot no longer matches.
      expect(data).toBe("membership_changed");
    } finally {
      await pg.query("rollback").catch(() => {});
    }
    expect(await memberProfile(victim)).toBeNull();
    const { data: group } = await admin
      .from("groups")
      .select("draw_version")
      .eq("id", groupId)
      .single();
    expect(group?.draw_version).toBe(version);
  });

  it("account deletion waits for an in-flight re-draw", async () => {
    const live = memberIds.slice(0, 3);
    const victim = memberIds[2];

    await pg.query("begin");
    try {
      const { rows } = await pg.query(
        "select public.perform_draw($1, $2::jsonb, 'drawn', $3) as r",
        [groupId, JSON.stringify(rotate(live, 2)), version],
      );
      expect(rows[0].r).toBe("ok");

      const { state, promise: ghostPromise } = track(
        admin.rpc("ghost_drawn_memberships", { p_profile_id: userIds[2] }),
      );
      // The deletion cannot null the member while the draw holds the lock.
      await waitUntilBlocked(pg, "ghost_drawn_memberships");
      expect(state.settled).toBe(false);
      expect(await memberProfile(victim)).toBe(userIds[2]);

      await pg.query("commit");
      const { data, error } = await ghostPromise;
      expect(error).toBeNull();
      expect(data).toBe(1);
    } finally {
      await pg.query("rollback").catch(() => {});
    }
    version += 1;
    expect(await memberProfile(victim)).toBeNull();
    // The draw committed with the member still live: it has assignments.
    const { data: assignments } = await admin
      .from("assignments")
      .select("giver_id")
      .eq("group_id", groupId);
    expect(assignments!.map((a) => a.giver_id).sort()).toEqual(
      [...live].sort(),
    );
  });

  it("leaves open groups untouched", async () => {
    const openGroupId = crypto.randomUUID();
    await admin.from("groups").insert({
      id: openGroupId,
      name: "Open",
      slug: `ghost-open-${run}`,
      year: 2099,
      created_by: userIds[0],
    });
    const { data: m } = await admin
      .from("memberships")
      .insert({
        group_id: openGroupId,
        profile_id: userIds[0],
        name_snapshot: "M0",
      })
      .select("id")
      .single();

    const { data, error } = await admin.rpc("ghost_drawn_memberships", {
      p_profile_id: userIds[0],
    });
    expect(error).toBeNull();
    // Only the drawn group's membership (userIds[0] is live there) is nulled.
    expect(data).toBe(1);
    expect(await memberProfile(m!.id as string)).toBe(userIds[0]);
    await admin.from("groups").delete().eq("id", openGroupId);
  });
});
