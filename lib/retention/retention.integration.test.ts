/**
 * @integration
 *
 * Retention cleanup against the real DB (#102): expired groups cascade away
 * with memberships + assignments (the drawn-membership delete guard must not
 * block), current groups survive, old audit rows go. Requires local Supabase:
 * `supabase start`. Uses the real clock: only data older than the retention
 * windows is touched, so parallel suites are unaffected. The account step is
 * covered by index.test.ts (auth.users timestamps cannot be backdated via API).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { runRetention } from "./index";
import { maxExpiredGroupYear } from "./policy";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("runRetention (integration)", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  const tag = `ret-${Date.now()}`;
  const expiredYear = maxExpiredGroupYear(new Date());
  let ownerId: string;
  let oldGroupId: string;
  let currentGroupId: string;
  let oldMemberIds: string[] = [];
  const auditTarget = `${tag}-audit`;

  beforeAll(async () => {
    const { data: u, error: ue } = await admin.auth.admin.createUser({
      email: `${tag}@test.local`,
      email_confirm: true,
    });
    if (ue) throw ue;
    ownerId = u.user.id;
    const { error: pe } = await admin
      .from("profiles")
      .insert({ id: ownerId, first_name: "Ret", last_name: "Owner" });
    if (pe) throw pe;

    const mkGroup = async (year: number, suffix: string) => {
      const { data, error } = await admin
        .from("groups")
        .insert({
          slug: `${tag}-${suffix}`,
          name: `Ret ${suffix}`,
          year,
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    };
    oldGroupId = await mkGroup(expiredYear, "old");
    currentGroupId = await mkGroup(new Date().getUTCFullYear(), "current");

    // Three ghost-style members + a draw in the old group, then mark drawn.
    const { data: members, error: me } = await admin
      .from("memberships")
      .insert(
        ["A", "B", "C"].map((n) => ({
          group_id: oldGroupId,
          name_snapshot: n,
        })),
      )
      .select("id");
    if (me) throw me;
    oldMemberIds = members.map((m) => m.id as string);
    const [a, b, c] = oldMemberIds;
    const { error: ae } = await admin.from("assignments").insert([
      { group_id: oldGroupId, giver_id: a, receiver_id: b },
      { group_id: oldGroupId, giver_id: b, receiver_id: c },
      { group_id: oldGroupId, giver_id: c, receiver_id: a },
    ]);
    if (ae) throw ae;
    const { error: se } = await admin
      .from("groups")
      .update({ state: "drawn" })
      .eq("id", oldGroupId);
    if (se) throw se;

    const old = new Date();
    old.setUTCFullYear(old.getUTCFullYear() - 2);
    const { error: le } = await admin.from("admin_audit_log").insert([
      {
        actor_email: "a@test.local",
        action: "delete_group",
        target_type: "group",
        target_id: auditTarget,
        created_at: old.toISOString(),
      },
      {
        actor_email: "a@test.local",
        action: "delete_group",
        target_type: "group",
        target_id: `${auditTarget}-fresh`,
      },
    ]);
    if (le) throw le;
  });

  afterAll(async () => {
    if (!hasSupabase) return;
    await admin.from("admin_audit_log").delete().like("target_id", `${tag}%`);
    await admin.from("groups").delete().like("slug", `${tag}-%`);
    await admin.auth.admin.deleteUser(ownerId);
  });

  it("deletes expired groups incl. memberships + assignments, keeps current ones, prunes old audit rows", async () => {
    const report = await runRetention();
    expect(report.failures).toEqual([]);
    expect(report.groupsDeleted).toBeGreaterThanOrEqual(1);
    expect(report.auditRowsDeleted).toBeGreaterThanOrEqual(1);

    const { data: oldGroup } = await admin
      .from("groups")
      .select("id")
      .eq("id", oldGroupId);
    expect(oldGroup).toEqual([]);
    const { data: members } = await admin
      .from("memberships")
      .select("id")
      .eq("group_id", oldGroupId);
    expect(members).toEqual([]);
    const { data: assignments } = await admin
      .from("assignments")
      .select("id")
      .eq("group_id", oldGroupId);
    expect(assignments).toEqual([]);

    const { data: current } = await admin
      .from("groups")
      .select("id")
      .eq("id", currentGroupId);
    expect(current).toHaveLength(1);

    const { data: audit } = await admin
      .from("admin_audit_log")
      .select("target_id")
      .like("target_id", `${tag}%`);
    expect(audit?.map((r) => r.target_id)).toEqual([`${auditTarget}-fresh`]);
  });

  it("is idempotent: a second run deletes nothing more of ours", async () => {
    const report = await runRetention();
    expect(report.failures).toEqual([]);
    const { data } = await admin
      .from("groups")
      .select("id")
      .eq("id", currentGroupId);
    expect(data).toHaveLength(1);
  });
});
