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
      state: "drawn",
      created_by: testUserId,
    });
    if (drawnErr) throw drawnErr;
    testGroupIdDrawn = drawnGroupId;
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
    expect(result.adminName).toContain("Test");
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
});
