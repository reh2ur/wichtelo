/**
 * @integration
 *
 * Integration tests for RLS policies on groups/memberships/invite_tokens.
 * Exercises the anon-key REST path directly (bypassing Server Actions) to
 * verify the authorization-bypass gaps fixed in
 * supabase/migrations/20260919181508_fix_rls_policy_gaps.sql stay closed.
 * Requires local Supabase running: `supabase start`
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { signInAs } from "@/lib/supabase/test-sign-in";

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)(
  "RLS: groups / memberships / invite_tokens",
  () => {
    let admin: ReturnType<typeof createAdminClient>;
    let groupId: string;
    let victimId: string;
    let attackerId: string;
    let attackerEmail: string;

    beforeAll(async () => {
      admin = createAdminClient();

      const { data: victim, error: victimError } =
        await admin.auth.admin.createUser({
          email: `rls-test-victim-${Date.now()}@example.com`,
          email_confirm: true,
        });
      if (victimError) throw victimError;
      victimId = victim.user.id;
      await admin
        .from("profiles")
        .insert({ id: victimId, first_name: "Victim", last_name: "Admin" });

      groupId = crypto.randomUUID();
      const { error: groupError } = await admin.from("groups").insert({
        id: groupId,
        name: "RLS Test Gruppe",
        slug: `rls-test-${Date.now()}`,
        year: 2099,
        state: "open",
        created_by: victimId,
      });
      if (groupError) throw groupError;

      const { error: tokenError } = await admin
        .from("invite_tokens")
        .insert({ group_id: groupId, token: crypto.randomUUID() });
      if (tokenError) throw tokenError;

      attackerEmail = `rls-test-attacker-${Date.now()}@example.com`;
      const { data: attacker, error: attackerError } =
        await admin.auth.admin.createUser({
          email: attackerEmail,
          email_confirm: true,
        });
      if (attackerError) throw attackerError;
      attackerId = attacker.user.id;
      await admin
        .from("profiles")
        .insert({ id: attackerId, first_name: "Attacker", last_name: "One" });
    });

    afterAll(async () => {
      await admin.from("memberships").delete().eq("group_id", groupId);
      await admin.from("invite_tokens").delete().eq("group_id", groupId);
      await admin.from("groups").delete().eq("id", groupId);
      await admin.from("profiles").delete().in("id", [attackerId, victimId]);
      await admin.auth.admin.deleteUser(attackerId);
      await admin.auth.admin.deleteUser(victimId);
    });

    function anonClient() {
      return createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      );
    }

    it("unauthenticated anon key cannot list invite_tokens", async () => {
      const anon = anonClient();
      const { data, error } = await anon
        .from("invite_tokens")
        .select("token, group_id");

      // RLS returns an empty set rather than an error for a disallowed select.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("authenticated user cannot self-insert as admin of an existing group they didn't create", async () => {
      const anon = anonClient();
      const { error: signInError } = await signInAs(anon, attackerEmail);
      expect(signInError).toBeNull();

      const { error } = await anon.from("memberships").insert({
        group_id: groupId,
        profile_id: attackerId,
        name_snapshot: "Attacker One",
        role: "admin",
      });

      expect(error).not.toBeNull();

      const { data: rows } = await admin
        .from("memberships")
        .select("id")
        .eq("group_id", groupId)
        .eq("profile_id", attackerId);
      expect(rows).toHaveLength(0);
    });

    it("authenticated user cannot create a group with created_by spoofed to another user", async () => {
      const anon = anonClient();
      const { error: signInError } = await signInAs(anon, attackerEmail);
      expect(signInError).toBeNull();

      const spoofedGroupId = crypto.randomUUID();
      const { error } = await anon.from("groups").insert({
        id: spoofedGroupId,
        name: "Spoofed Gruppe",
        slug: `spoofed-${Date.now()}`,
        year: 2099,
        state: "open",
        created_by: victimId,
      });

      expect(error).not.toBeNull();

      const { data: rows } = await admin
        .from("groups")
        .select("id")
        .eq("id", spoofedGroupId);
      expect(rows).toHaveLength(0);
    });

    it("authenticated user cannot create a group pre-set to state 'drawn'", async () => {
      const anon = anonClient();
      const { error: signInError } = await signInAs(anon, attackerEmail);
      expect(signInError).toBeNull();

      const drawnGroupId = crypto.randomUUID();
      const { error } = await anon.from("groups").insert({
        id: drawnGroupId,
        name: "Pre-drawn Gruppe",
        slug: `pre-drawn-${Date.now()}`,
        year: 2099,
        state: "drawn",
        created_by: attackerId,
      });

      expect(error).not.toBeNull();

      const { data: rows } = await admin
        .from("groups")
        .select("id")
        .eq("id", drawnGroupId);
      expect(rows).toHaveLength(0);
    });

    it("group creator can self-insert as the group's first admin (regression: createGroup flow)", async () => {
      const anon = anonClient();
      const { error: signInError } = await signInAs(anon, attackerEmail);
      expect(signInError).toBeNull();

      const ownGroupId = crypto.randomUUID();
      const { error: groupError } = await anon.from("groups").insert({
        id: ownGroupId,
        name: "Own Gruppe",
        slug: `own-gruppe-${Date.now()}`,
        year: 2099,
        state: "open",
        created_by: attackerId,
      });
      expect(groupError).toBeNull();

      const { error: membershipError } = await anon.from("memberships").insert({
        group_id: ownGroupId,
        profile_id: attackerId,
        name_snapshot: "Attacker One",
        role: "admin",
      });
      expect(membershipError).toBeNull();

      await admin.from("memberships").delete().eq("group_id", ownGroupId);
      await admin.from("groups").delete().eq("id", ownGroupId);
    });

    it("anon cannot call SECURITY DEFINER helpers via RPC (#191)", async () => {
      const anon = anonClient();
      for (const fn of [
        "is_member",
        "is_admin",
        "is_group_creator",
        "group_has_members",
      ]) {
        const { data, error } = await anon.rpc(fn, { p_group_id: groupId });
        expect(error, fn).not.toBeNull();
        expect(data, fn).toBeNull();
      }
    });

    it("anon select on RLS tables returns empty, not a permission error (#191)", async () => {
      const anon = anonClient();
      for (const table of ["groups", "memberships", "assignments"] as const) {
        const { data, error } = await anon.from(table).select("id");
        expect(error, table).toBeNull();
        expect(data, table).toEqual([]);
      }
    });

    it("authenticated can still evaluate helpers via RLS (#191)", async () => {
      const anon = anonClient();
      await signInAs(anon, attackerEmail);
      const { data, error } = await anon.from("groups").select("id");
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(Array);
    });

    describe("admin write bypasses (#178)", () => {
      let client: ReturnType<typeof anonClient>;
      let ownGroupId: string;

      beforeAll(async () => {
        client = anonClient();
        const { error: signInError } = await signInAs(client, attackerEmail);
        expect(signInError).toBeNull();

        ownGroupId = crypto.randomUUID();
        const { error: groupError } = await client.from("groups").insert({
          id: ownGroupId,
          name: "Admin Gruppe",
          slug: `admin-gruppe-${Date.now()}`,
          year: 2099,
          state: "open",
          created_by: attackerId,
        });
        expect(groupError).toBeNull();
        const { error: memberError } = await client.from("memberships").insert({
          group_id: ownGroupId,
          profile_id: attackerId,
          name_snapshot: "Attacker One",
          role: "admin",
        });
        expect(memberError).toBeNull();
      });

      afterAll(async () => {
        await admin.from("memberships").delete().eq("group_id", ownGroupId);
        await admin.from("groups").delete().eq("id", ownGroupId);
      });

      it("admin cannot change groups.created_by, slug or state", async () => {
        for (const patch of [
          { created_by: victimId },
          { slug: "hijacked-slug" },
          { state: "drawn" },
        ]) {
          const { error } = await client
            .from("groups")
            .update(patch)
            .eq("id", ownGroupId);
          expect(error, JSON.stringify(patch)).not.toBeNull();
        }
        const { data } = await admin
          .from("groups")
          .select("created_by, slug, state")
          .eq("id", ownGroupId)
          .single();
        expect(data?.created_by).toBe(attackerId);
        expect(data?.slug).not.toBe("hijacked-slug");
        expect(data?.state).toBe("open");
      });

      it("admin can still edit name / note / budget_hint", async () => {
        const { error } = await client
          .from("groups")
          .update({ name: "Neuer Name", note: "n", budget_hint: "10 EUR" })
          .eq("id", ownGroupId);
        expect(error).toBeNull();
      });

      it("admin cannot exceed length limits on groups", async () => {
        const { error } = await client
          .from("groups")
          .update({ name: "x".repeat(101) })
          .eq("id", ownGroupId);
        expect(error).not.toBeNull();
      });

      it("admin cannot insert a membership for another profile", async () => {
        const { error } = await client.from("memberships").insert({
          group_id: ownGroupId,
          profile_id: victimId,
          name_snapshot: "Victim Admin",
          role: "participant",
        });
        expect(error).not.toBeNull();
        const { data } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", ownGroupId)
          .eq("profile_id", victimId);
        expect(data).toHaveLength(0);
      });

      it("admin cannot insert a membership with no profile (admin INSERT policy dropped)", async () => {
        const { error } = await client.from("memberships").insert({
          group_id: ownGroupId,
          profile_id: null,
          name_snapshot: "Ghost",
          role: "participant",
        });
        expect(error).not.toBeNull();
        const { data } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", ownGroupId)
          .eq("name_snapshot", "Ghost");
        expect(data).toHaveLength(0);
      });

      it("admin UPDATE on memberships is limited to the role column", async () => {
        const { data: other, error: insertError } = await admin
          .from("memberships")
          .insert({
            group_id: ownGroupId,
            profile_id: victimId,
            name_snapshot: "Victim Admin",
            role: "participant",
          })
          .select("id")
          .single();
        expect(insertError).toBeNull();

        const { error: roleError } = await client
          .from("memberships")
          .update({ role: "admin" })
          .eq("id", other!.id);
        expect(roleError).toBeNull();
        const { data: promoted } = await admin
          .from("memberships")
          .select("role")
          .eq("id", other!.id)
          .single();
        expect(promoted?.role).toBe("admin");

        const { error: nameError } = await client
          .from("memberships")
          .update({ name_snapshot: "Renamed" })
          .eq("id", other!.id);
        expect(nameError).not.toBeNull();
        const { data: after } = await admin
          .from("memberships")
          .select("name_snapshot")
          .eq("id", other!.id)
          .single();
        expect(after?.name_snapshot).toBe("Victim Admin");

        await admin.from("memberships").delete().eq("id", other!.id);
      });

      it("admin cannot re-point a membership's profile_id or group_id", async () => {
        const { data: own } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", ownGroupId)
          .eq("profile_id", attackerId)
          .single();
        for (const patch of [
          { profile_id: victimId },
          { group_id: groupId },
          { name_snapshot: "Someone Else" },
        ]) {
          const { error } = await client
            .from("memberships")
            .update(patch)
            .eq("id", own!.id);
          expect(error, JSON.stringify(patch)).not.toBeNull();
        }
      });

      it("user cannot set profile names beyond the length limit or change profile id", async () => {
        const { error: longError } = await client
          .from("profiles")
          .update({ first_name: "x".repeat(51) })
          .eq("id", attackerId);
        expect(longError).not.toBeNull();

        const { error: idError } = await client
          .from("profiles")
          .update({ id: crypto.randomUUID() })
          .eq("id", attackerId);
        expect(idError).not.toBeNull();

        const { error: okError } = await client
          .from("profiles")
          .update({ first_name: "Attacker" })
          .eq("id", attackerId);
        expect(okError).toBeNull();
      });
    });

    describe("co-member name visibility (#179)", () => {
      let participant: ReturnType<typeof anonClient>;
      let participantId: string;
      let nameGroupId: string;
      const participantEmail = `rls-test-participant-${Date.now()}@example.com`;

      beforeAll(async () => {
        const { data, error } = await admin.auth.admin.createUser({
          email: participantEmail,
          email_confirm: true,
        });
        if (error) throw error;
        participantId = data.user.id;
        await admin.from("profiles").insert({
          id: participantId,
          first_name: "Part",
          last_name: "Icipant",
        });

        nameGroupId = crypto.randomUUID();
        await admin.from("groups").insert({
          id: nameGroupId,
          name: "Name Gruppe",
          slug: `name-gruppe-${Date.now()}`,
          year: 2099,
          state: "open",
          created_by: attackerId,
        });
        await admin.from("memberships").insert([
          {
            group_id: nameGroupId,
            profile_id: attackerId,
            name_snapshot: "Attacker One",
            role: "admin",
          },
          {
            group_id: nameGroupId,
            profile_id: participantId,
            name_snapshot: "Part Icipant",
            role: "participant",
          },
        ]);

        participant = anonClient();
        const { error: signInError } = await signInAs(
          participant,
          participantEmail,
        );
        expect(signInError).toBeNull();
      });

      afterAll(async () => {
        await admin.from("memberships").delete().eq("group_id", nameGroupId);
        await admin.from("groups").delete().eq("id", nameGroupId);
        await admin.from("profiles").delete().eq("id", participantId);
        await admin.auth.admin.deleteUser(participantId);
      });

      it("participant cannot read a co-member's profile", async () => {
        const { data, error } = await participant
          .from("profiles")
          .select("id, last_name")
          .eq("id", attackerId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });

      it("participant can read own profile", async () => {
        const { data } = await participant
          .from("profiles")
          .select("id")
          .eq("id", participantId);
        expect(data).toHaveLength(1);
      });

      it("participant sees only own membership row, not co-members' name_snapshot", async () => {
        const { data, error } = await participant
          .from("memberships")
          .select("profile_id, name_snapshot")
          .eq("group_id", nameGroupId);
        expect(error).toBeNull();
        expect(data).toEqual([
          { profile_id: participantId, name_snapshot: "Part Icipant" },
        ]);
      });

      it("group admin still sees all membership rows with full names", async () => {
        const adminClient = anonClient();
        await signInAs(adminClient, attackerEmail);
        const { data } = await adminClient
          .from("memberships")
          .select("name_snapshot")
          .eq("group_id", nameGroupId);
        expect(data).toHaveLength(2);
      });
    });
  },
);
