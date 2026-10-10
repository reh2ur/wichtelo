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

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

describe.skipIf(!hasSupabase)(
  "RLS: groups / memberships / invite_tokens",
  () => {
    let admin: ReturnType<typeof createAdminClient>;
    let groupId: string;
    let victimId: string;
    let attackerId: string;
    let attackerEmail: string;
    const password = "correct-horse-battery-staple-1";

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
          password,
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
      const { error: signInError } = await anon.auth.signInWithPassword({
        email: attackerEmail,
        password,
      });
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
      const { error: signInError } = await anon.auth.signInWithPassword({
        email: attackerEmail,
        password,
      });
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
      const { error: signInError } = await anon.auth.signInWithPassword({
        email: attackerEmail,
        password,
      });
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

    it("group creator can still create a group via create_group RPC (createGroup flow)", async () => {
      const anon = anonClient();
      const { error: signInError } = await anon.auth.signInWithPassword({
        email: attackerEmail,
        password,
      });
      expect(signInError).toBeNull();

      const { data, error } = await anon
        .rpc("create_group", {
          p_name: "Own Gruppe",
          p_year: 2099,
          p_budget_hint: null,
          p_note: null,
          p_slugs: [`own-gruppe-${Date.now()}`],
        })
        .single<{ group_id: string }>();
      expect(error).toBeNull();

      const { data: members } = await admin
        .from("memberships")
        .select("profile_id, role")
        .eq("group_id", data!.group_id);
      expect(members).toEqual([{ profile_id: attackerId, role: "admin" }]);

      await admin.from("groups").delete().eq("id", data!.group_id);
    });

    it("anon cannot call SECURITY DEFINER helpers via RPC (#191)", async () => {
      const anon = anonClient();
      for (const fn of ["is_member", "is_admin"]) {
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
      await anon.auth.signInWithPassword({ email: attackerEmail, password });
      const { data, error } = await anon.from("groups").select("id");
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(Array);
    });

    describe("no direct writes via PostgREST (#17, #178)", () => {
      let client: ReturnType<typeof anonClient>;
      let ownGroupId: string;
      let ownSlug: string;
      let ownMembershipId: string;
      let victimMembershipId: string;

      beforeAll(async () => {
        client = anonClient();
        const { error: signInError } = await client.auth.signInWithPassword({
          email: attackerEmail,
          password,
        });
        expect(signInError).toBeNull();

        // The only supported way for a user JWT to create a group.
        const { data, error } = await client
          .rpc("create_group", {
            p_name: "Admin Gruppe",
            p_year: 2099,
            p_budget_hint: null,
            p_note: null,
            p_slugs: [`admin-gruppe-${Date.now()}`],
          })
          .single<{ group_id: string; slug: string }>();
        expect(error).toBeNull();
        ownGroupId = data!.group_id;
        ownSlug = data!.slug;

        const { data: own } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", ownGroupId)
          .eq("profile_id", attackerId)
          .single();
        ownMembershipId = own!.id as string;

        // Second member + a drawn state, seeded with the service role. State
        // flips to drawn only after the memberships exist (join guard).
        const { data: victimMember, error: vErr } = await admin
          .from("memberships")
          .insert({
            group_id: ownGroupId,
            profile_id: victimId,
            name_snapshot: "Victim Admin",
            role: "participant",
          })
          .select("id")
          .single();
        expect(vErr).toBeNull();
        victimMembershipId = victimMember!.id as string;

        const { error: aErr } = await admin.from("assignments").insert([
          {
            group_id: ownGroupId,
            giver_id: ownMembershipId,
            receiver_id: victimMembershipId,
          },
          {
            group_id: ownGroupId,
            giver_id: victimMembershipId,
            receiver_id: ownMembershipId,
          },
        ]);
        expect(aErr).toBeNull();
        await admin
          .from("groups")
          .update({ state: "drawn" })
          .eq("id", ownGroupId);
      });

      afterAll(async () => {
        // Group delete cascades memberships (guard lets cascades through).
        await admin.from("groups").delete().eq("id", ownGroupId);
      });

      it("create_group via RPC works and makes the caller admin", async () => {
        const { data } = await admin
          .from("memberships")
          .select("role")
          .eq("id", ownMembershipId)
          .single();
        expect(data?.role).toBe("admin");
        const { data: token } = await client
          .from("invite_tokens")
          .select("token")
          .eq("group_id", ownGroupId);
        expect(token).toHaveLength(1);
      });

      it("admin sees only their own assignment row, not the whole draw", async () => {
        const { data, error } = await client
          .from("assignments")
          .select("giver_id, receiver_id")
          .eq("group_id", ownGroupId);
        expect(error).toBeNull();
        expect(data).toEqual([
          { giver_id: ownMembershipId, receiver_id: victimMembershipId },
        ]);
      });

      it("admin cannot insert, update or delete assignments", async () => {
        const { error: updateError } = await client
          .from("assignments")
          .update({ receiver_id: ownMembershipId })
          .eq("giver_id", victimMembershipId);
        expect(updateError).not.toBeNull();

        const { error: deleteError } = await client
          .from("assignments")
          .delete()
          .eq("group_id", ownGroupId);
        expect(deleteError).not.toBeNull();

        const { error: insertError } = await client.from("assignments").insert({
          group_id: ownGroupId,
          giver_id: ownMembershipId,
          receiver_id: victimMembershipId,
        });
        expect(insertError).not.toBeNull();

        const { count } = await admin
          .from("assignments")
          .select("*", { count: "exact", head: true })
          .eq("group_id", ownGroupId);
        expect(count).toBe(2);
      });

      it("user cannot delete their own profile row", async () => {
        const { error } = await client
          .from("profiles")
          .delete()
          .eq("id", attackerId);
        expect(error).not.toBeNull();
        const { data } = await admin
          .from("profiles")
          .select("id")
          .eq("id", attackerId);
        expect(data).toHaveLength(1);
      });

      it("admin cannot delete, demote or promote memberships", async () => {
        const { error: deleteError } = await client
          .from("memberships")
          .delete()
          .eq("id", victimMembershipId);
        expect(deleteError).not.toBeNull();

        const { error: roleError } = await client
          .from("memberships")
          .update({ role: "admin" })
          .eq("id", victimMembershipId);
        expect(roleError).not.toBeNull();

        const { error: demoteError } = await client
          .from("memberships")
          .update({ role: "participant" })
          .eq("id", ownMembershipId);
        expect(demoteError).not.toBeNull();

        const { data } = await admin
          .from("memberships")
          .select("id, role")
          .eq("group_id", ownGroupId);
        expect(data).toHaveLength(2);
        expect(data!.find((m) => m.id === ownMembershipId)?.role).toBe("admin");
        expect(data!.find((m) => m.id === victimMembershipId)?.role).toBe(
          "participant",
        );
      });

      it("admin cannot insert memberships (self, other profile or ghost)", async () => {
        for (const row of [
          { profile_id: victimId, name_snapshot: "Victim Admin" },
          { profile_id: null, name_snapshot: "Ghost" },
        ]) {
          const { error } = await client
            .from("memberships")
            .insert({ group_id: ownGroupId, role: "participant", ...row });
          expect(error, JSON.stringify(row)).not.toBeNull();
        }
      });

      it("admin cannot update or delete the group", async () => {
        for (const patch of [
          { name: "Neuer Name" },
          { year: 3000 },
          { created_by: victimId },
          { slug: "hijacked-slug" },
          { state: "open" },
        ]) {
          const { error } = await client
            .from("groups")
            .update(patch)
            .eq("id", ownGroupId);
          expect(error, JSON.stringify(patch)).not.toBeNull();
        }
        const { error: deleteError } = await client
          .from("groups")
          .delete()
          .eq("id", ownGroupId);
        expect(deleteError).not.toBeNull();

        const { data } = await admin
          .from("groups")
          .select("name, year, created_by, slug, state")
          .eq("id", ownGroupId)
          .single();
        expect(data).toEqual({
          name: "Admin Gruppe",
          year: 2099,
          created_by: attackerId,
          slug: ownSlug,
          state: "drawn",
        });
      });

      it("user cannot create a group by direct insert", async () => {
        const id = crypto.randomUUID();
        const { error } = await client.from("groups").insert({
          id,
          name: "Direct",
          slug: `direct-${Date.now()}`,
          year: 2099,
          created_by: attackerId,
        });
        expect(error).not.toBeNull();
        const { data } = await admin.from("groups").select("id").eq("id", id);
        expect(data).toHaveLength(0);
      });

      it("admin cannot write invite_tokens or exclusions", async () => {
        const { error: tokenUpdate } = await client
          .from("invite_tokens")
          .update({ token: "chosen-by-attacker" })
          .eq("group_id", ownGroupId);
        expect(tokenUpdate).not.toBeNull();
        const { error: tokenInsert } = await client
          .from("invite_tokens")
          .insert({ group_id: ownGroupId, token: "another-one" });
        expect(tokenInsert).not.toBeNull();
        const { error: tokenDelete } = await client
          .from("invite_tokens")
          .delete()
          .eq("group_id", ownGroupId);
        expect(tokenDelete).not.toBeNull();

        const [a, b] =
          ownMembershipId < victimMembershipId
            ? [ownMembershipId, victimMembershipId]
            : [victimMembershipId, ownMembershipId];
        const { error: exclusionInsert } = await client
          .from("exclusions")
          .insert({ group_id: ownGroupId, member_a: a, member_b: b });
        expect(exclusionInsert).not.toBeNull();

        const { data: tokens } = await admin
          .from("invite_tokens")
          .select("token")
          .eq("group_id", ownGroupId);
        expect(tokens).toHaveLength(1);
        expect(tokens![0].token).not.toBe("chosen-by-attacker");
        const { data: exclusions } = await admin
          .from("exclusions")
          .select("id")
          .eq("group_id", ownGroupId);
        expect(exclusions).toHaveLength(0);
      });

      it("dropped helper RPCs are no longer callable", async () => {
        for (const fn of ["is_group_creator", "group_has_members"]) {
          const { error } = await client.rpc(fn, { p_group_id: ownGroupId });
          expect(error, fn).not.toBeNull();
        }
      });

      it("authenticated cannot call remove_membership or perform_draw", async () => {
        const { error: removeError } = await client.rpc("remove_membership", {
          p_group_id: ownGroupId,
          p_membership_id: victimMembershipId,
          p_allow_drawn: true,
        });
        expect(removeError).not.toBeNull();
        const { error: drawError } = await client.rpc("perform_draw", {
          p_group_id: ownGroupId,
          p_pairs: [],
          p_expected_state: "drawn",
          p_expected_version: 0,
        });
        expect(drawError).not.toBeNull();
        const { data } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", ownGroupId);
        expect(data).toHaveLength(2);
      });

      it("user can still read and edit their own profile", async () => {
        const { data } = await client
          .from("profiles")
          .select("id")
          .eq("id", attackerId);
        expect(data).toHaveLength(1);
        const { error } = await client
          .from("profiles")
          .update({ first_name: "Attacker" })
          .eq("id", attackerId);
        expect(error).toBeNull();
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
      });
    });

    describe("create_group input validation (#17)", () => {
      let client: ReturnType<typeof anonClient>;
      const created: string[] = [];

      beforeAll(async () => {
        client = anonClient();
        const { error } = await client.auth.signInWithPassword({
          email: attackerEmail,
          password,
        });
        expect(error).toBeNull();
      });

      afterAll(async () => {
        if (created.length > 0)
          await admin.from("groups").delete().in("id", created);
      });

      const call = (args: { name?: string; year?: number; slugs?: string[] }) =>
        client
          .rpc("create_group", {
            p_name: args.name ?? "Valid Gruppe",
            p_year: args.year ?? 2099,
            p_budget_hint: null,
            p_note: null,
            p_slugs: args.slugs ?? [
              `valid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ],
          })
          .single<{ group_id: string; slug: string }>();

      it("rejects empty and over-long names", async () => {
        for (const name of ["", "   ", "x".repeat(101)]) {
          const { error } = await call({ name });
          expect(error, JSON.stringify(name)).not.toBeNull();
        }
      });

      it("rejects years outside 2000-2100", async () => {
        for (const year of [1999, 2101, 30000]) {
          const { error } = await call({ year });
          expect(error, String(year)).not.toBeNull();
        }
      });

      it("rejects malformed slugs", async () => {
        for (const slug of [
          "Upper",
          "with space",
          "under_score",
          "x".repeat(121),
          "",
        ]) {
          const { error } = await call({ slugs: [slug] });
          expect(error, slug).not.toBeNull();
        }
      });

      it("skips the reserved slug 'neu' and uses the next candidate", async () => {
        const next = `neu-${Date.now()}`;
        const { data, error } = await call({ slugs: ["neu", next] });
        expect(error).toBeNull();
        expect(data!.slug).toBe(next);
        created.push(data!.group_id);
      });

      it("fails when the only candidate is reserved", async () => {
        const { error } = await call({ slugs: ["neu"] });
        expect(error).not.toBeNull();
      });

      it("accepts valid input", async () => {
        const { data, error } = await call({ name: "Gültig", year: 2100 });
        expect(error).toBeNull();
        created.push(data!.group_id);
      });
    });

    describe("membership delete guard + remove_membership (#17, #18)", () => {
      let guardGroupId: string;
      let adminMemberId: string;
      let memberAId: string;
      let memberBId: string;
      let ghostId: string;

      beforeAll(async () => {
        guardGroupId = crypto.randomUUID();
        const { error } = await admin.from("groups").insert({
          id: guardGroupId,
          name: "Guard Gruppe",
          slug: `guard-${Date.now()}`,
          year: 2099,
          created_by: victimId,
        });
        expect(error).toBeNull();
        const { data: rows, error: mErr } = await admin
          .from("memberships")
          .insert([
            {
              group_id: guardGroupId,
              profile_id: victimId,
              name_snapshot: "Victim Admin",
              role: "admin",
            },
            {
              group_id: guardGroupId,
              profile_id: attackerId,
              name_snapshot: "Attacker One",
              role: "participant",
            },
            {
              group_id: guardGroupId,
              name_snapshot: "Ghost",
              role: "participant",
            },
          ])
          .select("id, name_snapshot");
        expect(mErr).toBeNull();
        const byName = (n: string) =>
          rows!.find((r) => r.name_snapshot === n)!.id as string;
        adminMemberId = byName("Victim Admin");
        memberAId = byName("Attacker One");
        ghostId = byName("Ghost");
        const { data: b } = await admin
          .from("memberships")
          .insert({
            group_id: guardGroupId,
            name_snapshot: "B",
            role: "participant",
          })
          .select("id")
          .single();
        memberBId = b!.id as string;
      });

      afterAll(async () => {
        await admin.from("groups").delete().eq("id", guardGroupId);
      });

      const remove = (id: string, allowDrawn = false, enforce = true) =>
        admin.rpc("remove_membership", {
          p_group_id: guardGroupId,
          p_membership_id: id,
          p_allow_drawn: allowDrawn,
          p_enforce_last_admin: enforce,
        });

      it("open group: removal works, last admin is protected, unknown ids reported", async () => {
        const { data: last } = await remove(adminMemberId);
        expect(last).toBe("last_admin");

        const { data: missing } = await remove(crypto.randomUUID());
        expect(missing).toBe("member_not_found");

        const { data: ok } = await remove(memberBId);
        expect(ok).toBe("ok");
        const { data: gone } = await admin
          .from("memberships")
          .select("id")
          .eq("id", memberBId);
        expect(gone).toHaveLength(0);
      });

      it("open group: wrong group id is not found", async () => {
        const { data } = await admin.rpc("remove_membership", {
          p_group_id: crypto.randomUUID(),
          p_membership_id: memberAId,
        });
        expect(data).toBe("group_not_found");
      });

      it("drawn group: plain delete is rejected, assignments stay intact", async () => {
        // Ghost is removed first so the drawn state is reachable (open guard).
        await remove(ghostId);
        const { error: aErr } = await admin.from("assignments").insert([
          {
            group_id: guardGroupId,
            giver_id: adminMemberId,
            receiver_id: memberAId,
          },
          {
            group_id: guardGroupId,
            giver_id: memberAId,
            receiver_id: adminMemberId,
          },
        ]);
        expect(aErr).toBeNull();
        await admin
          .from("groups")
          .update({ state: "drawn" })
          .eq("id", guardGroupId);

        const { error } = await admin
          .from("memberships")
          .delete()
          .eq("id", memberAId);
        expect(error?.message).toContain("already drawn");

        const { count } = await admin
          .from("assignments")
          .select("*", { count: "exact", head: true })
          .eq("group_id", guardGroupId);
        expect(count).toBe(2);
      });

      it("drawn group: RPC without allow_drawn refuses", async () => {
        const { data } = await remove(memberAId);
        expect(data).toBe("already_drawn");
      });

      it("drawn group: admin removal with allow_drawn works and cascades assignments", async () => {
        const { data } = await remove(memberAId, true);
        expect(data).toBe("ok");
        const { data: m } = await admin
          .from("memberships")
          .select("id")
          .eq("id", memberAId);
        expect(m).toHaveLength(0);
        const { count } = await admin
          .from("assignments")
          .select("*", { count: "exact", head: true })
          .eq("group_id", guardGroupId);
        expect(count).toBe(0);
      });

      it("drawn group: allow flag does not leak to later plain deletes", async () => {
        const { data: extra } = await admin
          .from("groups")
          .select("state")
          .eq("id", guardGroupId)
          .single();
        expect(extra?.state).toBe("drawn");
        const { error } = await admin
          .from("memberships")
          .delete()
          .eq("id", adminMemberId);
        expect(error?.message).toContain("already drawn");
      });

      it("group delete still cascades memberships of a drawn group", async () => {
        const id = crypto.randomUUID();
        await admin.from("groups").insert({
          id,
          name: "Cascade",
          slug: `cascade-${Date.now()}`,
          year: 2099,
          created_by: victimId,
        });
        await admin.from("memberships").insert({
          group_id: id,
          profile_id: victimId,
          name_snapshot: "Victim Admin",
          role: "admin",
        });
        await admin.from("groups").update({ state: "drawn" }).eq("id", id);
        const { error } = await admin.from("groups").delete().eq("id", id);
        expect(error).toBeNull();
        const { data } = await admin
          .from("memberships")
          .select("id")
          .eq("group_id", id);
        expect(data).toHaveLength(0);
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
          password,
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
        const { error: signInError } =
          await participant.auth.signInWithPassword({
            email: participantEmail,
            password,
          });
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
        await adminClient.auth.signInWithPassword({
          email: attackerEmail,
          password,
        });
        const { data } = await adminClient
          .from("memberships")
          .select("name_snapshot")
          .eq("group_id", nameGroupId);
        expect(data).toHaveLength(2);
      });
    });
  },
);
