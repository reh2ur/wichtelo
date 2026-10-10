"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { groupTag } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGroupContact } from "@/lib/group-admins";
import { notify } from "@/lib/notification";
import { logger } from "@/lib/logger";
import { computeDraw, TOO_COMPLEX } from "@/lib/draw";
import { rotateToken } from "@/lib/invite";
import { removeMembership } from "@/lib/membership";
import { checkRateLimit, exclusionAddLimiter } from "@/lib/rate-limit";

const nameSchema = z.string().min(1).max(100);
const budgetHintSchema = z.string().max(200);
const noteSchema = z.string().max(1000);

export type UpdateGroupState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error:
        | "not_admin"
        | "group_not_found"
        | "missing_name"
        | "too_long"
        | "generic";
      /** Limit that was exceeded (only with `too_long`). */
      max?: number;
      /** Submitted input, echoed so the form survives validation errors. */
      values?: { name: string; budgetHint: string; note: string };
    };

export type ExclusionState =
  | { status: "idle" }
  | {
      status: "success";
      /** Set when the exclusions now make a valid draw impossible. */
      warning?: "unsolvable" | "too_complex";
    }
  | {
      status: "error";
      error:
        | "not_admin"
        | "group_not_found"
        | "same_member"
        | "invalid_member"
        | "exists"
        | "generic"
        | "rate_limited";
    };

export type RemoveExclusionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "not_admin" | "group_not_found" | "generic" };

export type PromoteState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error: "not_admin" | "group_not_found" | "no_account" | "generic";
    };

export type RemoveMemberState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error: "not_admin" | "group_not_found" | "last_admin" | "generic";
    };

export type RotateInviteState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error: "not_admin" | "group_not_found" | "drawn" | "generic";
    };

export type DeleteGroupState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "not_admin" | "group_not_found" | "generic" };

async function assertAdmin(slug: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not_admin" as const };

  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("id, slug, name, year, state")
    .eq("slug", slug)
    .single();
  if (!group) return { error: "group_not_found" as const };

  const { data: membership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .single();
  if (!membership || membership.role !== "admin")
    return { error: "not_admin" as const };

  return {
    group: group as {
      id: string;
      slug: string;
      name: string;
      year: number;
      state: "open" | "drawn";
    },
    admin,
    userId: user.id,
  };
}

export async function updateGroupInfo(
  _prev: UpdateGroupState,
  formData: FormData,
): Promise<UpdateGroupState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const budgetHint =
    (formData.get("budgetHint") as string | null)?.trim() || null;
  const note = (formData.get("note") as string | null)?.trim() || null;

  const values = { name, budgetHint: budgetHint ?? "", note: note ?? "" };
  if (!name) return { status: "error", error: "missing_name", values };
  if (!nameSchema.safeParse(name).success)
    return { status: "error", error: "too_long", max: 100, values };
  if (budgetHint && !budgetHintSchema.safeParse(budgetHint).success)
    return { status: "error", error: "too_long", max: 200, values };
  if (note && !noteSchema.safeParse(note).success)
    return { status: "error", error: "too_long", max: 1000, values };

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
      values,
    };
  }
  const { group, admin } = result;

  const { error } = await admin
    .from("groups")
    .update({ name, budget_hint: budgetHint, note })
    .eq("id", group.id);

  if (error) {
    logger
      .withMetadata({ groupId: group.id, reason: error.message })
      .error("group.update_failed");
    return { status: "error", error: "generic" };
  }

  logger.withMetadata({ groupId: group.id }).info("group.updated");
  updateTag(groupTag(slug));
  return { status: "success" };
}

export async function addExclusion(
  _prev: ExclusionState,
  formData: FormData,
): Promise<ExclusionState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const inputA = (formData.get("memberA") as string | null)?.trim() ?? "";
  const inputB = (formData.get("memberB") as string | null)?.trim() ?? "";

  if (!inputA || !inputB || inputA === inputB)
    return { status: "error", error: "same_member" };

  // Enforce canonical ordering required by DB check constraint
  const [memberA, memberB] =
    inputA < inputB ? [inputA, inputB] : [inputB, inputA];

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
    };
  }
  const { group, admin, userId } = result;

  if (!(await checkRateLimit(exclusionAddLimiter, userId))) {
    return { status: "error", error: "rate_limited" };
  }

  // Both members must belong to this group (#201).
  const { data: pairMembers } = await admin
    .from("memberships")
    .select("id")
    .eq("group_id", group.id)
    .in("id", [memberA, memberB]);
  if ((pairMembers ?? []).length !== 2)
    return { status: "error", error: "invalid_member" };

  const { error } = await admin
    .from("exclusions")
    .insert({ group_id: group.id, member_a: memberA, member_b: memberB });

  if (error) {
    if (error.code === "23505") return { status: "error", error: "exists" };
    logger
      .withMetadata({ groupId: group.id, reason: error.message })
      .error("exclusion.add_failed");
    return { status: "error", error: "generic" };
  }

  logger.withMetadata({ groupId: group.id }).info("exclusion.added");
  updateTag(groupTag(slug));

  // Feasibility warning: tell the admin right away if the exclusions now make
  // a valid draw impossible, instead of failing at draw time.
  const [{ data: allMembers }, { data: allExclusions }] = await Promise.all([
    admin.from("memberships").select("id").eq("group_id", group.id),
    admin
      .from("exclusions")
      .select("member_a, member_b")
      .eq("group_id", group.id),
  ]);
  const ids = (allMembers ?? []).map((m: { id: string }) => m.id);
  const pairs = (
    (allExclusions ?? []) as { member_a: string; member_b: string }[]
  ).map((e): [string, string] => [e.member_a, e.member_b]);
  if (ids.length >= 3) {
    const result = computeDraw(ids, pairs);
    if (result === TOO_COMPLEX) {
      return { status: "success", warning: "too_complex" };
    }
    if (result === null) {
      return { status: "success", warning: "unsolvable" };
    }
  }
  return { status: "success" };
}

export async function removeExclusion(
  _prev: RemoveExclusionState,
  formData: FormData,
): Promise<RemoveExclusionState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const memberA = (formData.get("memberA") as string | null)?.trim() ?? "";
  const memberB = (formData.get("memberB") as string | null)?.trim() ?? "";

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
    };
  }
  const { group, admin } = result;

  const { error } = await admin
    .from("exclusions")
    .delete()
    .eq("group_id", group.id)
    .eq("member_a", memberA)
    .eq("member_b", memberB);

  if (error) {
    logger
      .withMetadata({ groupId: group.id, reason: error.message })
      .error("exclusion.remove_failed");
    return { status: "error", error: "generic" };
  }

  logger.withMetadata({ groupId: group.id }).info("exclusion.removed");
  updateTag(groupTag(slug));
  return { status: "success" };
}

export async function promoteToAdmin(
  _prev: PromoteState,
  formData: FormData,
): Promise<PromoteState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const membershipId =
    (formData.get("membershipId") as string | null)?.trim() ?? "";

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
    };
  }
  const { group, admin } = result;

  const { data: target } = await admin
    .from("memberships")
    .select("profile_id")
    .eq("id", membershipId)
    .eq("group_id", group.id)
    .single();

  if (!target) return { status: "error", error: "generic" };
  if (!(target as { profile_id: string | null }).profile_id) {
    return { status: "error", error: "no_account" };
  }

  const { error } = await admin
    .from("memberships")
    .update({ role: "admin" })
    .eq("id", membershipId)
    .eq("group_id", group.id);

  if (error) {
    logger
      .withMetadata({ groupId: group.id, membershipId, reason: error.message })
      .error("membership.promote_failed");
    return { status: "error", error: "generic" };
  }

  logger
    .withMetadata({ groupId: group.id, membershipId })
    .info("membership.promoted_to_admin");
  updateTag(groupTag(slug));
  return { status: "success" };
}

export async function removeMember(
  _prev: RemoveMemberState,
  formData: FormData,
): Promise<RemoveMemberState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const membershipId =
    (formData.get("membershipId") as string | null)?.trim() ?? "";

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
    };
  }
  const { group, admin } = result;

  const { data: targetRaw } = await admin
    .from("memberships")
    .select("id, role, profile_id, name_snapshot")
    .eq("id", membershipId)
    .eq("group_id", group.id)
    .single();

  if (!targetRaw) return { status: "error", error: "generic" };

  const target = targetRaw as {
    id: string;
    role: string;
    profile_id: string | null;
    name_snapshot: string;
  };

  // Allowed after the draw too (ghost or live member). The RPC locks the
  // group; the removed member's assignments cascade, so the admin re-draws.
  const { result: removal, reason } = await removeMembership(
    admin,
    group.id,
    membershipId,
    { allowDrawn: true },
  );
  if (removal === "last_admin") {
    return { status: "error", error: "last_admin" };
  }
  if (removal === "member_not_found") {
    return { status: "error", error: "generic" };
  }
  if (removal !== "ok") {
    logger
      .withMetadata({ groupId: group.id, membershipId, reason })
      .error("membership.remove_failed");
    return { status: "error", error: "generic" };
  }

  logger
    .withMetadata({ groupId: group.id, membershipId })
    .info("membership.left");

  if (target.profile_id) {
    const { data: userData } = await admin.auth.admin.getUserById(
      target.profile_id,
    );
    if (userData?.user?.email) {
      await notify({
        type: "participant.left",
        groupName: group.name,
        participantName: target.name_snapshot,
        participantEmail: userData.user.email,
        postDraw: group.state === "drawn",
        adminEmails: [],
      });
    }
  }

  updateTag(groupTag(slug));
  return { status: "success" };
}

export async function regenerateInviteLink(
  _prev: RotateInviteState,
  formData: FormData,
): Promise<RotateInviteState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
    };
  }
  const { group } = result;

  // Invites are already dead after the draw.
  if (group.state === "drawn") return { status: "error", error: "drawn" };

  try {
    await rotateToken(group.id);
  } catch (e) {
    logger
      .withMetadata({
        groupId: group.id,
        reason: e instanceof Error ? e.message : String(e),
      })
      .error("invite.rotate_failed");
    return { status: "error", error: "generic" };
  }

  logger.withMetadata({ groupId: group.id }).info("invite.rotated");
  updateTag(groupTag(slug));
  return { status: "success" };
}

export async function deleteGroup(
  _prev: DeleteGroupState,
  formData: FormData,
): Promise<DeleteGroupState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";

  const result = await assertAdmin(slug);
  if ("error" in result) {
    return {
      status: "error",
      error:
        result.error === "group_not_found" ? "group_not_found" : "not_admin",
    };
  }
  const { group, admin, userId } = result;

  const { data: membersRaw } = await admin
    .from("memberships")
    .select("profile_id, name_snapshot")
    .eq("group_id", group.id);

  const contact = await resolveGroupContact(admin, group.id, userId);

  const { error } = await admin.from("groups").delete().eq("id", group.id);

  if (error) {
    logger
      .withMetadata({ groupId: group.id, reason: error.message })
      .error("group.delete_failed");
    return { status: "error", error: "generic" };
  }

  logger.withMetadata({ groupId: group.id }).info("group.deleted");
  // No updateTag here: it would make Next ship a refreshed tree for the
  // current route (now 404) in this action's response, unmounting the
  // client before it navigates. Client calls invalidateDeletedGroup after
  // navigating instead.

  const recipients = (
    await Promise.all(
      (
        (membersRaw ?? []) as {
          profile_id: string | null;
          name_snapshot: string;
        }[]
      ).map(async (m) => {
        if (!m.profile_id) return null;
        const { data: userData } = await admin.auth.admin.getUserById(
          m.profile_id,
        );
        const to = userData?.user?.email;
        return to ? { to, name: m.name_snapshot } : null;
      }),
    )
  ).filter((r): r is { to: string; name: string } => r !== null);
  if (recipients.length > 0) {
    await notify({
      type: "group.deleted",
      groupName: group.name,
      year: group.year,
      adminName: contact?.name ?? null,
      adminEmail: contact?.email ?? null,
      recipients,
    });
  }

  // Navigate client-side instead of calling next/navigation's redirect()
  // here: a Server Action redirect is resolved by an internal same-request
  // fetch back into the app (Next pre-renders the destination inline to
  // save a round trip), which can race the delete that just committed and
  // briefly render /gruppen with zero groups (issue #138). Returning
  // "success" lets the client do a normal post-mutation navigation instead,
  // which always re-fetches fresh.
  return { status: "success" };
}

/**
 * Expire the cached shell of a deleted group (#174). Separate action so the
 * client can run it after navigating away: `updateTag` inside `deleteGroup`
 * would re-render the now-missing settings route and unmount the delete
 * button before its redirect. Safe without auth: it only expires cache when
 * the group row is already gone.
 */
export async function invalidateDeletedGroup(slug: string): Promise<void> {
  const parsed = z.string().min(1).max(200).safeParse(slug);
  if (!parsed.success) return;
  const { data } = await createAdminClient()
    .from("groups")
    .select("id")
    .eq("slug", parsed.data)
    .maybeSingle();
  if (data) return;
  updateTag(groupTag(parsed.data));
}
