/**
 * @integration
 *
 * Integration tests for account deletion module.
 * Requires local Supabase running: `supabase start`
 */

import { createHmac } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  deleteAccount,
  createDeletionToken,
  verifyDeletionToken,
} from "./index";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("deleteAccount", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any;
  let testUserId: string;
  let adminUserId: string;

  const testEmail = `account-deletion-test-${Date.now()}@test.local`;
  const adminEmail = `account-admin-test-${Date.now()}@test.local`;

  beforeAll(async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    supabase = createAdminClient();

    const { data: u1, error: e1 } = await supabase.auth.admin.createUser({
      email: testEmail,
      email_confirm: true,
    });
    if (e1) throw new Error(`createUser failed: ${e1.message}`);
    testUserId = u1.user.id;

    const { data: u2, error: e2 } = await supabase.auth.admin.createUser({
      email: adminEmail,
      email_confirm: true,
    });
    if (e2) throw new Error(`createUser admin failed: ${e2.message}`);
    adminUserId = u2.user.id;

    await supabase
      .from("profiles")
      .insert({ id: testUserId, first_name: "Max", last_name: "Mustermann" });
    await supabase
      .from("profiles")
      .insert({ id: adminUserId, first_name: "Anna", last_name: "Admin" });
  });

  afterAll(async () => {
    if (supabase && adminUserId) {
      await supabase.from("groups").delete().eq("created_by", adminUserId);
      await supabase.auth.admin.deleteUser(adminUserId);
    }
  });

  it("nullifies memberships, preserves name_snapshot, deletes auth user", async () => {
    const slug = `del-test-${Date.now()}`;
    const { data: group, error: ge } = await supabase
      .from("groups")
      .insert({
        slug,
        name: "Test Gruppe",
        state: "open",
        created_by: adminUserId,
        year: 2024,
      })
      .select("id")
      .single();
    if (ge) throw new Error(`createGroup failed: ${ge.message}`);
    const groupId = group.id;

    await supabase.from("memberships").insert({
      group_id: groupId,
      profile_id: adminUserId,
      name_snapshot: "Anna Admin",
      role: "admin",
    });
    const { data: mem } = await supabase
      .from("memberships")
      .insert({
        group_id: groupId,
        profile_id: testUserId,
        name_snapshot: "Max Mustermann",
        role: "participant",
      })
      .select("id")
      .single();
    const membershipId = mem.id;
    // Trigger rejects membership inserts into a drawn group: draw after seeding.
    await supabase.from("groups").update({ state: "drawn" }).eq("id", groupId);

    const result = await deleteAccount(testUserId);

    expect(result.nullifiedMembershipCount).toBe(1);

    const { data: m } = await supabase
      .from("memberships")
      .select("profile_id, name_snapshot")
      .eq("id", membershipId)
      .single();
    expect(m.profile_id).toBeNull();
    expect(m.name_snapshot).toBe("Max Mustermann");

    const { data: deletedUser } =
      await supabase.auth.admin.getUserById(testUserId);
    expect(deletedUser.user).toBeNull();
  });

  it("returns affected drawn groups with admin emails", async () => {
    const secondEmail = `account-deletion2-${Date.now()}@test.local`;
    const { data: u3 } = await supabase.auth.admin.createUser({
      email: secondEmail,
      email_confirm: true,
    });
    const secondUserId = u3.user.id;
    await supabase
      .from("profiles")
      .insert({ id: secondUserId, first_name: "Zweiter", last_name: "Nutzer" });

    const slug = `drawn-${Date.now()}`;
    const { data: group } = await supabase
      .from("groups")
      .insert({
        slug,
        name: "Ausgelost Gruppe",
        state: "open",
        created_by: adminUserId,
        year: 2024,
      })
      .select("id")
      .single();
    await supabase.from("memberships").insert({
      group_id: group.id,
      profile_id: adminUserId,
      name_snapshot: "Anna Admin",
      role: "admin",
    });
    await supabase.from("memberships").insert({
      group_id: group.id,
      profile_id: secondUserId,
      name_snapshot: "Zweiter Nutzer",
    });
    // Trigger rejects membership inserts into a drawn group: draw after seeding.
    await supabase.from("groups").update({ state: "drawn" }).eq("id", group.id);

    const result = await deleteAccount(secondUserId);

    expect(result.affectedDrawnGroups).toHaveLength(1);
    expect(result.affectedDrawnGroups[0].adminEmails).toContain(adminEmail);
    expect(result.affectedDrawnGroups[0].name).toBe("Ausgelost Gruppe");

    await supabase.auth.admin.deleteUser(secondUserId).catch(() => {});
  });

  it("open groups: membership removed, admins notified via affectedOpenGroups", async () => {
    const thirdEmail = `account-deletion3-${Date.now()}@test.local`;
    const { data: u4 } = await supabase.auth.admin.createUser({
      email: thirdEmail,
      email_confirm: true,
    });
    const thirdUserId = u4.user.id;
    await supabase
      .from("profiles")
      .insert({ id: thirdUserId, first_name: "Dritter", last_name: "Nutzer" });

    const slug = `open-${Date.now()}`;
    const { data: group } = await supabase
      .from("groups")
      .insert({
        slug,
        name: "Offene Gruppe",
        state: "open",
        created_by: adminUserId,
        year: 2024,
      })
      .select("id")
      .single();
    await supabase.from("memberships").insert({
      group_id: group.id,
      profile_id: adminUserId,
      name_snapshot: "Anna Admin",
      role: "admin",
    });
    await supabase.from("memberships").insert({
      group_id: group.id,
      profile_id: thirdUserId,
      name_snapshot: "Dritter Nutzer",
    });

    const result = await deleteAccount(thirdUserId);

    expect(result.affectedDrawnGroups).toHaveLength(0);
    expect(result.nullifiedMembershipCount).toBe(1);
    expect(result.affectedOpenGroups).toHaveLength(1);
    expect(result.affectedOpenGroups[0].adminEmails).toContain(adminEmail);

    const { data: left } = await supabase
      .from("memberships")
      .select("id")
      .eq("group_id", group.id)
      .eq("name_snapshot", "Dritter Nutzer");
    expect(left).toHaveLength(0);

    await supabase.auth.admin.deleteUser(thirdUserId).catch(() => {});
  });
});

describe("createDeletionToken / verifyDeletionToken", () => {
  it("round-trips valid token", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const token = createDeletionToken(userId, "nonce1");
    const result = verifyDeletionToken(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.userId).toBe(userId);
      expect(result.nonce).toBe("nonce1");
    }
  });

  it("rejects tampered token", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const token = createDeletionToken(userId, "nonce1");
    const parts = token.split(".");
    parts[3] = "tampered";
    expect(verifyDeletionToken(parts.join(".")).valid).toBe(false);
  });

  it("rejects expired token", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const expires = Math.floor(Date.now() / 1000) - 1;
    const secret =
      process.env.ACCOUNT_DELETION_SECRET ?? "dev-only-account-deletion-secret";
    const hmac = createHmac("sha256", secret)
      .update(`${userId}:${expires}:nonce1`)
      .digest("base64url");
    const token = `${userId}.${expires}.nonce1.${hmac}`;
    expect(verifyDeletionToken(token).valid).toBe(false);
  });

  it("rejects token with tampered nonce", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const parts = createDeletionToken(userId, "nonce1").split(".");
    parts[2] = "nonce2";
    expect(verifyDeletionToken(parts.join(".")).valid).toBe(false);
  });

  it("rejects malformed token", () => {
    expect(verifyDeletionToken("not-a-valid-token").valid).toBe(false);
    expect(verifyDeletionToken("a.b").valid).toBe(false);
  });
});
