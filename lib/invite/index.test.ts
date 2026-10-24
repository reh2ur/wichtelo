/**
 * @integration
 *
 * Integration tests for invite token module.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createToken,
  resolveToken,
  getOrCreateToken,
  rotateToken,
} from "./index";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)("invite token module", () => {
  // Initialised inside the describe block so createAdminClient() is never
  // called at module scope — avoids crashing in CI where Supabase env vars
  // are absent.
  let supabase: ReturnType<typeof createAdminClient>;
  let testGroupIdOpen: string;
  let testGroupIdDrawn: string;
  let testUserId: string;

  beforeAll(async () => {
    supabase = createAdminClient();

    const { data: userData, error: userError } =
      await supabase.auth.admin.createUser({
        email: `invite-test-${Date.now()}@example.com`,
        email_confirm: true,
      });
    if (userError) throw userError;
    testUserId = userData.user.id;

    await supabase
      .from("profiles")
      .insert({ id: testUserId, first_name: "Test", last_name: "Admin" });

    const openGroupId = crypto.randomUUID();
    const { error: openErr } = await supabase.from("groups").insert({
      id: openGroupId,
      name: "Invite Test Gruppe (open)",
      slug: `invite-test-open-${Date.now()}`,
      year: 2099,
      state: "open",
      created_by: testUserId,
    });
    if (openErr) throw openErr;
    testGroupIdOpen = openGroupId;

    const drawnGroupId = crypto.randomUUID();
    const { error: drawnErr } = await supabase.from("groups").insert({
      id: drawnGroupId,
      name: "Invite Test Gruppe (drawn)",
      slug: `invite-test-drawn-${Date.now()}`,
      year: 2099,
      state: "open",
      created_by: testUserId,
    });
    if (drawnErr) throw drawnErr;
    testGroupIdDrawn = drawnGroupId;
    // Dead-end contact is the group's oldest live admin membership. Memberships
    // can't be inserted once drawn, so flip the state afterwards.
    const { error: adminErr } = await supabase.from("memberships").insert({
      group_id: drawnGroupId,
      profile_id: testUserId,
      name_snapshot: "Test Admin",
      role: "admin",
    });
    if (adminErr) throw adminErr;
    const { error: stateErr } = await supabase
      .from("groups")
      .update({ state: "drawn" })
      .eq("id", drawnGroupId);
    if (stateErr) throw stateErr;
  });

  afterEach(async () => {
    // group_id is unique on invite_tokens — clear between tests so each can
    // freely create its own token for testGroupIdOpen/testGroupIdDrawn.
    await supabase
      .from("invite_tokens")
      .delete()
      .in("group_id", [testGroupIdOpen, testGroupIdDrawn]);
  });

  afterAll(async () => {
    await supabase
      .from("groups")
      .delete()
      .in("id", [testGroupIdOpen, testGroupIdDrawn]);

    await supabase.from("profiles").delete().eq("id", testUserId);
    await supabase.auth.admin.deleteUser(testUserId);
  });

  it("createToken inserts a row and returns a UUID token", async () => {
    const token = await createToken(testGroupIdOpen);
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const { data } = await supabase
      .from("invite_tokens")
      .select("token")
      .eq("token", token)
      .single();
    expect(data?.token).toBe(token);
  });

  it("resolveToken returns group data for an open group", async () => {
    const token = await createToken(testGroupIdOpen);
    const result = await resolveToken(token);

    expect(result).not.toBeNull();
    if (result === null) return;

    expect(result.group.id).toBe(testGroupIdOpen);
    expect(result.group.state).toBe("open");
    // Contact name only resolved for the drawn dead-end page.
    expect(result.adminName).toBe("");
  });

  it("resolveToken returns group with state 'drawn' when group has already drawn", async () => {
    const token = await createToken(testGroupIdDrawn);
    const result = await resolveToken(token);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.group.state).toBe("drawn");
    expect(result.adminName).toContain("Test");
  });

  it("resolveToken returns null for an unknown token", async () => {
    const result = await resolveToken(crypto.randomUUID());
    expect(result).toBeNull();
  });

  it("getOrCreateToken returns the same token across repeated calls", async () => {
    const first = await getOrCreateToken(testGroupIdOpen);
    const second = await getOrCreateToken(testGroupIdOpen);
    expect(second).toBe(first);

    const { data: rows } = await supabase
      .from("invite_tokens")
      .select("token")
      .eq("group_id", testGroupIdOpen);
    expect(rows).toHaveLength(1);
  });

  it("getOrCreateToken converges on one token under concurrent calls", async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateToken(testGroupIdOpen),
      getOrCreateToken(testGroupIdOpen),
      getOrCreateToken(testGroupIdOpen),
    ]);
    expect(b).toBe(a);
    expect(c).toBe(a);

    const { data: rows } = await supabase
      .from("invite_tokens")
      .select("token")
      .eq("group_id", testGroupIdOpen);
    expect(rows).toHaveLength(1);
  });

  it("rotateToken replaces the token: old one stops resolving, new one resolves", async () => {
    const oldToken = await getOrCreateToken(testGroupIdOpen);
    const newToken = await rotateToken(testGroupIdOpen);

    expect(newToken).not.toBe(oldToken);
    expect(await resolveToken(oldToken)).toBeNull();
    expect((await resolveToken(newToken))?.group.id).toBe(testGroupIdOpen);
    expect(await getOrCreateToken(testGroupIdOpen)).toBe(newToken);
  });

  it("a token still resolves after a participant joins the group", async () => {
    const token = await getOrCreateToken(testGroupIdOpen);

    const { data: participant, error: participantError } =
      await supabase.auth.admin.createUser({
        email: `invite-test-participant-${Date.now()}@example.com`,
        email_confirm: true,
      });
    if (participantError) throw participantError;
    const participantId = participant.user.id;
    await supabase
      .from("profiles")
      .insert({ id: participantId, first_name: "Part", last_name: "One" });
    await supabase.from("memberships").insert({
      group_id: testGroupIdOpen,
      profile_id: participantId,
      name_snapshot: "Part One",
      role: "participant",
    });

    try {
      const stillSameToken = await getOrCreateToken(testGroupIdOpen);
      expect(stillSameToken).toBe(token);

      const result = await resolveToken(token);
      expect(result).not.toBeNull();
      expect(result?.group.id).toBe(testGroupIdOpen);
    } finally {
      await supabase
        .from("memberships")
        .delete()
        .eq("group_id", testGroupIdOpen)
        .eq("profile_id", participantId);
      await supabase.from("profiles").delete().eq("id", participantId);
      await supabase.auth.admin.deleteUser(participantId);
    }
  });

  describe("creator account deleted (groups.created_by = NULL)", () => {
    let creatorId: string;
    let secondAdminId: string;
    let groupId: string;

    beforeAll(async () => {
      const make = async (label: string, first: string) => {
        const { data, error } = await supabase.auth.admin.createUser({
          email: `invite-test-${label}-${Date.now()}@example.com`,
          email_confirm: true,
        });
        if (error) throw error;
        const { error: profileError } = await supabase.from("profiles").insert({
          id: data.user.id,
          first_name: first,
          last_name: "Nachname",
        });
        if (profileError) throw profileError;
        return data.user.id;
      };
      creatorId = await make("creator", "Creator");
      secondAdminId = await make("admin2", "Zweite");

      groupId = crypto.randomUUID();
      const { error: groupError } = await supabase.from("groups").insert({
        id: groupId,
        name: "Invite Test Gruppe (creator gone)",
        slug: `invite-test-gone-${Date.now()}`,
        year: 2099,
        state: "open",
        created_by: creatorId,
      });
      if (groupError) throw groupError;

      const { error: membershipError } = await supabase
        .from("memberships")
        .insert([
          {
            group_id: groupId,
            profile_id: creatorId,
            name_snapshot: "Creator Nachname",
            role: "admin",
            joined_at: "2099-01-01T00:00:00Z",
          },
          {
            group_id: groupId,
            profile_id: secondAdminId,
            name_snapshot: "Zweite Nachname",
            role: "admin",
            joined_at: "2099-01-02T00:00:00Z",
          },
        ]);
      if (membershipError) throw membershipError;

      // Account deletion: profile row goes, FK nulls created_by + profile_id.
      const { error: deleteError } = await supabase
        .from("profiles")
        .delete()
        .eq("id", creatorId);
      if (deleteError) throw deleteError;
    });

    afterAll(async () => {
      await supabase.from("groups").delete().eq("id", groupId);
      await supabase.from("profiles").delete().eq("id", secondAdminId);
      await supabase.auth.admin.deleteUser(secondAdminId);
      await supabase.auth.admin.deleteUser(creatorId);
    });

    it("created_by is NULL after creator profile delete", async () => {
      const { data } = await supabase
        .from("groups")
        .select("created_by")
        .eq("id", groupId)
        .single();
      expect(data?.created_by).toBeNull();
    });

    it("resolveToken returns the open group", async () => {
      const token = await createToken(groupId);
      const result = await resolveToken(token);
      expect(result?.group.id).toBe(groupId);
      expect(result?.group.created_by).toBeNull();
    });

    it("resolveToken on a drawn group names a current admin", async () => {
      const token = await getOrCreateToken(groupId);
      const { error } = await supabase
        .from("groups")
        .update({ state: "drawn" })
        .eq("id", groupId);
      if (error) throw error;

      const result = await resolveToken(token);
      expect(result?.group.state).toBe("drawn");
      expect(result?.adminName).toBe("Zweite N.");
    });
  });
});
