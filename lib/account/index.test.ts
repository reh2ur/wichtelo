/**
 * @integration
 *
 * Integration tests for account deletion module.
 * Requires local Supabase running: `supabase start`
 */

import { createHmac } from "crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteAccount,
  findSoleAdminGroups,
  createDeletionToken,
  verifyDeletionToken,
} from "./index";

// Pass-through wrapper so a single test can hand deleteAccount a client whose
// auth.admin.deleteUser fails once (simulated partial failure, #137).
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/supabase/admin")>();
  return { ...mod, createAdminClient: vi.fn(mod.createAdminClient) };
});

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

  it("open group: removing the membership also cascades its exclusions", async () => {
    const { data: u } = await supabase.auth.admin.createUser({
      email: `account-deletion-excl-${Date.now()}@test.local`,
      email_confirm: true,
    });
    const userId = u.user.id;
    await supabase
      .from("profiles")
      .insert({ id: userId, first_name: "Excl", last_name: "Nutzer" });
    const { data: group } = await supabase
      .from("groups")
      .insert({
        slug: `open-excl-${Date.now()}`,
        name: "Exclusion Gruppe",
        state: "open",
        created_by: adminUserId,
        year: 2024,
      })
      .select("id")
      .single();
    const { data: members } = await supabase
      .from("memberships")
      .insert([
        {
          group_id: group.id,
          profile_id: adminUserId,
          name_snapshot: "Anna Admin",
          role: "admin",
        },
        {
          group_id: group.id,
          profile_id: userId,
          name_snapshot: "Excl",
          role: "participant",
        },
      ])
      .select("id");
    const [a, b] = [members[0].id, members[1].id].sort();
    await supabase
      .from("exclusions")
      .insert({ group_id: group.id, member_a: a, member_b: b });

    await deleteAccount(userId);

    const { data: exclusions } = await supabase
      .from("exclusions")
      .select("id")
      .eq("group_id", group.id);
    expect(exclusions).toHaveLength(0);
  });

  it("findSoleAdminGroups lists only groups without another live admin", async () => {
    const { data: u } = await supabase.auth.admin.createUser({
      email: `account-sole-admin-${Date.now()}@test.local`,
      email_confirm: true,
    });
    const soleId = u.user.id;
    await supabase
      .from("profiles")
      .insert({ id: soleId, first_name: "Sole", last_name: "Admin" });

    const mkGroup = async (slug: string) => {
      const { data } = await supabase
        .from("groups")
        .insert({
          slug: `${slug}-${Date.now()}`,
          name: slug,
          state: "open",
          created_by: soleId,
          year: 2024,
        })
        .select("id")
        .single();
      return data.id as string;
    };
    const solo = await mkGroup("sole-solo");
    const shared = await mkGroup("sole-shared");
    await supabase.from("memberships").insert([
      {
        group_id: solo,
        profile_id: soleId,
        name_snapshot: "Sole Admin",
        role: "admin",
      },
      {
        group_id: shared,
        profile_id: soleId,
        name_snapshot: "Sole Admin",
        role: "admin",
      },
      {
        group_id: shared,
        profile_id: adminUserId,
        name_snapshot: "Anna Admin",
        role: "admin",
      },
    ]);

    const result = await findSoleAdminGroups(soleId);
    expect(result.map((g) => g.groupId)).toEqual([solo]);

    await supabase.from("groups").delete().in("id", [solo, shared]);
    await supabase.auth.admin.deleteUser(soleId).catch(() => {});
  });

  it("retry after a failed deleteUser still returns open and drawn groups (#137)", async () => {
    const { data: u } = await supabase.auth.admin.createUser({
      email: `account-deletion-retry-${Date.now()}@test.local`,
      email_confirm: true,
    });
    const userId = u.user.id;
    await supabase
      .from("profiles")
      .insert({ id: userId, first_name: "Retry", last_name: "Nutzer" });

    const groupIds: string[] = [];
    const mkGroup = async (name: string) => {
      const { data: group } = await supabase
        .from("groups")
        .insert({
          slug: `retry-${name.toLowerCase()}-${Date.now()}`,
          name,
          state: "open",
          created_by: adminUserId,
          year: 2024,
        })
        .select("id")
        .single();
      groupIds.push(group.id);
      const { error } = await supabase.from("memberships").insert([
        {
          group_id: group.id,
          profile_id: adminUserId,
          name_snapshot: "Anna Admin",
          role: "admin",
        },
        {
          group_id: group.id,
          profile_id: userId,
          name_snapshot: "Retry Nutzer",
          role: "participant",
        },
      ]);
      expect(error).toBeNull();
      return group.id as string;
    };
    const openId = await mkGroup("RetryOffen");
    const drawnId = await mkGroup("RetryGezogen");
    // Trigger rejects membership inserts into a drawn group: draw afterwards.
    await supabase.from("groups").update({ state: "drawn" }).eq("id", drawnId);

    // Attempt 1: cleanup succeeds, deleteUser fails.
    const real = createAdminClient();
    const failing = Object.create(real);
    Object.defineProperty(failing, "auth", {
      value: {
        admin: Object.create(real.auth.admin, {
          deleteUser: {
            value: async () => ({ error: { message: "simulated failure" } }),
          },
        }),
      },
    });
    vi.mocked(createAdminClient).mockImplementationOnce(() => failing);
    await expect(deleteAccount(userId)).rejects.toEqual({
      message: "simulated failure",
    });

    // Account survives, open membership gone, drawn membership ghosted.
    const { data: stillThere } = await supabase.auth.admin.getUserById(userId);
    expect(stillThere.user).not.toBeNull();
    const { data: mine } = await supabase
      .from("memberships")
      .select("id")
      .eq("profile_id", userId);
    expect(mine).toHaveLength(0);

    // Attempt 2: the groups from attempt 1 must still be reported.
    const result = await deleteAccount(userId);
    expect(result.affectedOpenGroups.map((g) => g.groupId)).toEqual([openId]);
    expect(result.affectedOpenGroups[0].adminEmails).toContain(adminEmail);
    expect(result.affectedDrawnGroups.map((g) => g.groupId)).toEqual([drawnId]);
    expect(result.affectedDrawnGroups[0].adminEmails).toContain(adminEmail);
    expect(result.affectedDrawnGroups[0].participantName).toBe("Retry Nutzer");

    const { data: gone } = await supabase.auth.admin.getUserById(userId);
    expect(gone.user).toBeNull();
    await supabase.from("groups").delete().in("id", groupIds);
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
