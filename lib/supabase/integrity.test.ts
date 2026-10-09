/**
 * @integration
 *
 * Integration tests for assignment / exclusion integrity constraints
 * (supabase/migrations/20261008030000_fk_indexes_and_group_integrity.sql).
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("assignment / exclusion integrity", () => {
  const admin = hasSupabase ? createAdminClient() : (null as never);
  let userId: string;
  let groupA: string;
  let groupB: string;
  let a1: string;
  let a2: string;
  let b1: string;

  async function makeGroup(suffix: string) {
    const id = crypto.randomUUID();
    const { error } = await admin.from("groups").insert({
      id,
      name: `Integrity ${suffix}`,
      slug: `integrity-${suffix}-${Date.now()}`,
      year: 2099,
      created_by: userId,
    });
    if (error) throw error;
    return id;
  }

  async function makeMember(groupId: string, name: string) {
    const { data, error } = await admin
      .from("memberships")
      .insert({ group_id: groupId, name_snapshot: name })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `integrity-${Date.now()}@example.com`,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    await admin
      .from("profiles")
      .insert({ id: userId, first_name: "Integrity", last_name: "Admin" });
    groupA = await makeGroup("a");
    groupB = await makeGroup("b");
    a1 = await makeMember(groupA, "A1");
    a2 = await makeMember(groupA, "A2");
    b1 = await makeMember(groupB, "B1");
  });

  afterAll(async () => {
    await admin.from("groups").delete().in("id", [groupA, groupB]);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  });

  it("rejects self-assignment", async () => {
    const { error } = await admin
      .from("assignments")
      .insert({ group_id: groupA, giver_id: a1, receiver_id: a1 });
    expect(error).not.toBeNull();
  });

  it("rejects assignment whose giver or receiver is in another group", async () => {
    const { error: receiverError } = await admin
      .from("assignments")
      .insert({ group_id: groupA, giver_id: a1, receiver_id: b1 });
    expect(receiverError).not.toBeNull();

    const { error: giverError } = await admin
      .from("assignments")
      .insert({ group_id: groupA, giver_id: b1, receiver_id: a1 });
    expect(giverError).not.toBeNull();
  });

  it("rejects exclusion with a member from another group", async () => {
    const [lo, hi] = [a1, b1].sort();
    const { error } = await admin
      .from("exclusions")
      .insert({ group_id: groupA, member_a: lo, member_b: hi });
    expect(error).not.toBeNull();
  });

  it("accepts valid same-group assignment and exclusion, cascading on membership delete", async () => {
    const { error } = await admin
      .from("assignments")
      .insert({ group_id: groupA, giver_id: a1, receiver_id: a2 });
    expect(error).toBeNull();

    const [lo, hi] = [a1, a2].sort();
    const { error: exError } = await admin
      .from("exclusions")
      .insert({ group_id: groupA, member_a: lo, member_b: hi });
    expect(exError).toBeNull();

    await admin.from("memberships").delete().eq("id", a2);
    const { data: assignments } = await admin
      .from("assignments")
      .select("id")
      .eq("group_id", groupA);
    const { data: exclusions } = await admin
      .from("exclusions")
      .select("id")
      .eq("group_id", groupA);
    expect(assignments).toEqual([]);
    expect(exclusions).toEqual([]);
  });
});
