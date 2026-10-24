"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { groupTag } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeDraw,
  hasGhostMembers,
  liveMembers,
  loadAssignment,
  loadDrawInputs,
  loadMemberships,
  TOO_COMPLEX,
  type Assignment,
  type ExclusionPair,
} from "@/lib/draw";
import { getGroupAdminEmails, resolveGroupContact } from "@/lib/group-admins";
import { notify, type NotifyResult } from "@/lib/notification";
import { logger } from "@/lib/logger";
import { removeMembership } from "@/lib/membership";
import {
  buildDrawAssignmentRecipients,
  postDrawVersion,
  resendEventType,
  type MembershipRow,
} from "@/lib/draw-mail";
import { recordDrawMailResult } from "@/lib/draw-mail-status";
import {
  checkRateLimit,
  drawTriggerLimiter,
  joinLeaveLimiter,
} from "@/lib/rate-limit";

export type LeaveGroupState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error:
        | "not_authenticated"
        | "not_member"
        | "last_admin"
        | "already_drawn"
        | "rate_limited"
        | "generic";
    };

export async function leaveGroup(
  _prev: LeaveGroupState,
  formData: FormData,
): Promise<LeaveGroupState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  if (!slug) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  if (!(await checkRateLimit(joinLeaveLimiter, user.id))) {
    return { status: "error", error: "rate_limited" };
  }

  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("id, slug, name, state")
    .eq("slug", slug)
    .single();

  // Same code for unknown slug and non-member: no slug-existence oracle.
  if (!group) return { status: "error", error: "not_member" };

  const groupId = (
    group as { id: string; slug: string; name: string; state: string }
  ).id;

  const { data: callerMembership } = await admin
    .from("memberships")
    .select("id, role, name_snapshot")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .single();

  if (!callerMembership) return { status: "error", error: "not_member" };

  // Leaving after draw would cascade-delete assignment rows and break the draw.
  if ((group as { state: string }).state === "drawn") {
    return { status: "error", error: "already_drawn" };
  }

  const membership = callerMembership as {
    id: string;
    role: string;
    name_snapshot: string;
  };

  // Locks the group row: a draw cannot slip in between the checks and the delete.
  const { result, reason } = await removeMembership(
    admin,
    groupId,
    membership.id,
  );
  if (result === "last_admin" || result === "already_drawn") {
    return { status: "error", error: result };
  }
  if (result === "member_not_found") {
    return { status: "error", error: "not_member" };
  }
  if (result !== "ok") {
    logger
      .withMetadata({
        groupId,
        membershipId: membership.id,
        reason,
      })
      .error("membership.leave_failed");
    return { status: "error", error: "generic" };
  }

  logger
    .withMetadata({ groupId, membershipId: membership.id })
    .info("membership.left");

  if (user.email) {
    const adminEmails = await getGroupAdminEmails(admin, groupId, user.id);
    await notify({
      type: "participant.left",
      groupName: (group as { name: string }).name,
      participantName: membership.name_snapshot,
      participantEmail: user.email,
      adminEmails,
    });
  }

  updateTag(groupTag(slug));
  redirect("/gruppen");
}

export type DrawState =
  | { status: "idle" }
  | { status: "success"; emailsFailed: number; emailsTotal: number }
  | {
      status: "error";
      error:
        | "not_authenticated"
        | "not_admin"
        | "group_not_found"
        | "already_drawn"
        | "not_enough_members"
        | "unsolvable"
        | "too_complex"
        | "ghost_members"
        | "generic"
        | "rate_limited";
    };

export async function triggerDraw(
  _prev: DrawState,
  formData: FormData,
): Promise<DrawState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  if (!slug) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  const admin = createAdminClient();

  const { data: group, error: groupError } = await admin
    .from("groups")
    .select("id, slug, state, draw_version, name, year")
    .eq("slug", slug)
    .single();

  // Same error as "not an admin" so slug existence isn't revealed (#181).
  if (groupError || !group) {
    return { status: "error", error: "not_admin" };
  }

  const groupId = group.id as string;

  const { data: callerMembership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .single();

  if (!callerMembership || callerMembership.role !== "admin") {
    return { status: "error", error: "not_admin" };
  }

  // Limiter after admin check, keyed per user: outsiders can't burn the
  // real admin's budget (#181).
  if (!(await checkRateLimit(drawTriggerLimiter, `${slug}:${user.id}`))) {
    return { status: "error", error: "rate_limited" };
  }

  if (group.state === "drawn") {
    return { status: "error", error: "already_drawn" };
  }

  let inputs: Awaited<ReturnType<typeof loadDrawInputs>>;
  try {
    inputs = await loadDrawInputs(admin, groupId);
  } catch (err) {
    logger
      .withMetadata({
        groupId,
        reason: err instanceof Error ? err.message : String(err),
      })
      .error("draw.load_failed");
    return { status: "error", error: "generic" };
  }

  const memberRows: MembershipRow[] = inputs.members;

  if (memberRows.length < 3) {
    logger
      .withMetadata({ groupId, participantCount: memberRows.length })
      .error("draw.failed");
    return { status: "error", error: "not_enough_members" };
  }

  if (hasGhostMembers(memberRows)) {
    logger.withMetadata({ groupId }).error("draw.failed_ghost_members");
    return { status: "error", error: "ghost_members" };
  }

  const exclusions: ExclusionPair[] = inputs.exclusions.map((e) => [
    e.member_a,
    e.member_b,
  ]);

  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.triggered");

  const memberIds = memberRows.map((m) => m.id);
  const assignment = computeDraw(memberIds, exclusions);

  if (assignment === TOO_COMPLEX) {
    logger
      .withMetadata({
        groupId,
        participantCount: memberRows.length,
        reason: "too_complex",
      })
      .error("draw.too_complex");
    return { status: "error", error: "too_complex" };
  }

  if (!assignment) {
    logger
      .withMetadata({
        groupId,
        participantCount: memberRows.length,
        reason: "unsolvable_constraints",
      })
      .error("draw.failed");
    return { status: "error", error: "unsolvable" };
  }

  const assignmentRows = Array.from(assignment.entries()).map(
    ([giver, receiver]) => ({
      group_id: groupId,
      giver_id: giver,
      receiver_id: receiver,
    }),
  );

  const { data: drawResult, error: drawError } = await admin.rpc(
    "perform_draw",
    {
      p_group_id: groupId,
      p_pairs: assignmentRows,
      p_expected_state: "open",
      p_expected_version: group.draw_version as number,
    },
  );
  if (drawError || drawResult !== "ok") {
    logger
      .withMetadata({
        groupId,
        reason: drawError?.message ?? (drawResult as string),
      })
      .error("draw.failed");
    if (drawResult === "state_changed") {
      return { status: "error", error: "already_drawn" };
    }
    if (drawResult === "ghost_members") {
      return { status: "error", error: "ghost_members" };
    }
    return { status: "error", error: "generic" };
  }

  // Expire the cached shell right away: the DB is `drawn` now, and a timeout
  // in the mail steps below must not leave "open" + draw button cached.
  updateTag(groupTag(slug));

  logger
    .withMetadata({ groupId, from: "open", to: "drawn" })
    .info("group.state_changed");
  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.succeeded");

  const contact = await resolveGroupContact(admin, groupId, user.id);
  const { recipients: assignments, skipped } =
    await buildDrawAssignmentRecipients(admin, memberRows, assignment);
  const emailResult: NotifyResult = await notify({
    type: "draw.completed",
    groupId,
    drawKey: String(postDrawVersion(group.draw_version as number)),
    groupName: group.name as string,
    groupSlug: slug,
    year: group.year as number,
    adminName: contact?.name ?? null,
    adminEmail: contact?.email ?? null,
    assignments,
  });

  const emailsFailed = emailResult.failed + skipped;
  const emailsTotal = emailResult.sent + emailResult.failed + skipped;
  // Persisted so the resend option survives tab close / other devices; a
  // clean send clears any warning left over from the previous draw.
  await recordDrawMailResult(
    admin,
    groupId,
    postDrawVersion(group.draw_version as number),
    emailsFailed,
    emailsTotal,
  );

  return { status: "success", emailsFailed, emailsTotal };
}

export type RetriggerDrawState =
  | { status: "idle" }
  | { status: "success"; emailsFailed: number; emailsTotal: number }
  | {
      status: "error";
      error:
        | "not_authenticated"
        | "not_admin"
        | "group_not_found"
        | "not_drawn"
        | "not_enough_members"
        | "unsolvable"
        | "membership_changed"
        | "too_complex"
        | "generic"
        | "rate_limited";
    };

export async function retriggerDraw(
  _prev: RetriggerDrawState,
  formData: FormData,
): Promise<RetriggerDrawState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  if (!slug) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  const admin = createAdminClient();

  const { data: group, error: groupError } = await admin
    .from("groups")
    .select("id, slug, state, draw_version, name, year")
    .eq("slug", slug)
    .single();

  // Same error as "not an admin" so slug existence isn't revealed (#181).
  if (groupError || !group) {
    return { status: "error", error: "not_admin" };
  }

  const groupId = group.id as string;

  const { data: callerMembership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .single();

  if (!callerMembership || callerMembership.role !== "admin") {
    return { status: "error", error: "not_admin" };
  }

  // Limiter after admin check, keyed per user: outsiders can't burn the
  // real admin's budget (#181).
  if (!(await checkRateLimit(drawTriggerLimiter, `${slug}:${user.id}`))) {
    return { status: "error", error: "rate_limited" };
  }

  if (group.state !== "drawn") {
    return { status: "error", error: "not_drawn" };
  }

  let inputs: Awaited<ReturnType<typeof loadDrawInputs>>;
  try {
    inputs = await loadDrawInputs(admin, groupId);
  } catch (err) {
    logger
      .withMetadata({
        groupId,
        reason: err instanceof Error ? err.message : String(err),
      })
      .error("draw.load_failed");
    return { status: "error", error: "generic" };
  }

  // Deleted accounts keep their row after the draw; they are not redrawn and
  // perform_draw removes them atomically with the new assignments.
  const memberRows: MembershipRow[] = liveMembers(inputs.members);

  if (memberRows.length < 3) {
    logger
      .withMetadata({ groupId, participantCount: memberRows.length })
      .error("draw.retrigger_failed");
    return { status: "error", error: "not_enough_members" };
  }

  const liveIds = new Set(memberRows.map((m) => m.id));
  const exclusions: ExclusionPair[] = inputs.exclusions
    .filter((e) => liveIds.has(e.member_a) && liveIds.has(e.member_b))
    .map((e) => [e.member_a, e.member_b]);

  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.retrigger_triggered");

  const memberIds = memberRows.map((m) => m.id);
  const assignment = computeDraw(memberIds, exclusions);

  if (assignment === TOO_COMPLEX) {
    logger
      .withMetadata({
        groupId,
        participantCount: memberRows.length,
        reason: "too_complex",
      })
      .error("draw.too_complex");
    return { status: "error", error: "too_complex" };
  }

  if (!assignment) {
    logger
      .withMetadata({
        groupId,
        participantCount: memberRows.length,
        reason: "unsolvable_constraints",
      })
      .error("draw.retrigger_failed");
    return { status: "error", error: "unsolvable" };
  }

  const assignmentRows = Array.from(assignment.entries()).map(
    ([giver, receiver]) => ({
      group_id: groupId,
      giver_id: giver,
      receiver_id: receiver,
    }),
  );

  const { data: drawResult, error: drawError } = await admin.rpc(
    "perform_draw",
    {
      p_group_id: groupId,
      p_pairs: assignmentRows,
      p_expected_state: "drawn",
      p_expected_version: group.draw_version as number,
    },
  );
  if (drawError || drawResult !== "ok") {
    logger
      .withMetadata({
        groupId,
        reason: drawError?.message ?? (drawResult as string),
      })
      .error("draw.retrigger_failed");
    if (drawResult === "state_changed") {
      return { status: "error", error: "not_drawn" };
    }
    if (drawResult === "membership_changed") {
      return { status: "error", error: "membership_changed" };
    }
    return { status: "error", error: "generic" };
  }

  updateTag(groupTag(slug));

  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.retrigger_succeeded");

  const contact = await resolveGroupContact(admin, groupId, user.id);
  const { recipients: assignments, skipped } =
    await buildDrawAssignmentRecipients(admin, memberRows, assignment);
  const emailResult: NotifyResult = await notify({
    type: "draw.redrawn",
    groupId,
    drawKey: String(postDrawVersion(group.draw_version as number)),
    groupName: group.name as string,
    groupSlug: slug,
    year: group.year as number,
    adminName: contact?.name ?? null,
    adminEmail: contact?.email ?? null,
    assignments,
  });

  const emailsFailed = emailResult.failed + skipped;
  const emailsTotal = emailResult.sent + emailResult.failed + skipped;
  // Persisted so the resend option survives tab close / other devices; a
  // clean send clears any warning left over from the previous draw.
  await recordDrawMailResult(
    admin,
    groupId,
    postDrawVersion(group.draw_version as number),
    emailsFailed,
    emailsTotal,
  );

  return { status: "success", emailsFailed, emailsTotal };
}

export type OracleState =
  | { status: "idle" }
  | { status: "success"; giverId: string; receiverName: string }
  | {
      status: "error";
      error: "not_authenticated" | "not_admin" | "not_found" | "generic";
    };

export async function lookupAssignment(
  _prev: OracleState,
  formData: FormData,
): Promise<OracleState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const membershipId =
    (formData.get("membershipId") as string | null)?.trim() ?? "";
  if (!slug || !membershipId) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("id")
    .eq("slug", slug)
    .single();

  // Same code for unknown slug and non-admin: no slug-existence oracle.
  if (!group) return { status: "error", error: "not_admin" };

  const groupId = (group as { id: string }).id;

  const { data: callerMembership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .single();

  if (!callerMembership || callerMembership.role !== "admin") {
    return { status: "error", error: "not_admin" };
  }

  const { data: assignment } = await admin
    .from("assignments")
    .select("receiver_id")
    .eq("group_id", groupId)
    .eq("giver_id", membershipId)
    .single();

  if (!assignment) return { status: "error", error: "not_found" };

  const receiverId = (assignment as { receiver_id: string }).receiver_id;

  const { data: receiverMembership } = await admin
    .from("memberships")
    .select("name_snapshot, profile_id")
    .eq("id", receiverId)
    .single();

  if (!receiverMembership) return { status: "error", error: "not_found" };

  const membership = receiverMembership as {
    name_snapshot: string;
    profile_id: string | null;
  };

  let receiverName = membership.name_snapshot;
  if (membership.profile_id) {
    const { data: profile } = await admin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", membership.profile_id)
      .single();
    if (profile) {
      const p = profile as { first_name: string; last_name: string };
      receiverName = `${p.first_name} ${p.last_name}`;
    }
  }

  logger
    .withMetadata({ groupId, giverId: membershipId })
    .info("admin.oracle_lookup");

  return { status: "success", giverId: membershipId, receiverName };
}

export type ResendDrawEmailsState =
  | { status: "idle" }
  | { status: "success"; emailsFailed: number; emailsTotal: number }
  | {
      status: "error";
      error:
        | "not_authenticated"
        | "not_admin"
        | "not_drawn"
        | "generic"
        | "rate_limited";
    };

/**
 * Re-sends draw emails for the current draw after a partial failure. Uses the
 * same idempotency keys as the original send (group + post-draw draw_version + chunk)
 * so Resend returns the stored result for chunks already delivered (within its
 * 24h key window) and only genuinely failed chunks go out again.
 */
export async function resendDrawEmails(
  _prev: ResendDrawEmailsState,
  formData: FormData,
): Promise<ResendDrawEmailsState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  if (!slug) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("id, state, draw_version, name, year")
    .eq("slug", slug)
    .single();
  // Same error as "not an admin" so slug existence isn't revealed (#181).
  if (!group) return { status: "error", error: "not_admin" };

  const groupId = group.id as string;

  const { data: callerMembership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .single();
  if (!callerMembership || callerMembership.role !== "admin") {
    return { status: "error", error: "not_admin" };
  }

  if (!(await checkRateLimit(drawTriggerLimiter, `${slug}:${user.id}`))) {
    return { status: "error", error: "rate_limited" };
  }

  if (group.state !== "drawn") {
    return { status: "error", error: "not_drawn" };
  }

  let memberRows: MembershipRow[];
  let assignment: Assignment;
  try {
    [memberRows, assignment] = await Promise.all([
      loadMemberships(admin, groupId),
      loadAssignment(admin, groupId),
    ]);
  } catch (err) {
    logger
      .withMetadata({
        groupId,
        reason: err instanceof Error ? err.message : String(err),
      })
      .error("draw.resend_load_failed");
    return { status: "error", error: "generic" };
  }
  // A drawn group always has assignments + members. Empty means a lost read,
  // not "nothing to send": bail out so the stored warning stays untouched.
  if (memberRows.length === 0 || assignment.size === 0) {
    logger
      .withMetadata({
        groupId,
        members: memberRows.length,
        assignments: assignment.size,
      })
      .error("draw.resend_no_recipients");
    return { status: "error", error: "generic" };
  }

  const contact = await resolveGroupContact(admin, groupId, user.id);
  const { recipients: assignments, skipped } =
    await buildDrawAssignmentRecipients(admin, memberRows, assignment);
  // Here `draw_version` is already the post-draw value (first draw = 1), the
  // same one trigger/re-draw keyed their sends with. Anything above 1 means a
  // re-draw happened, so the redrawn template applies.
  const drawVersion = group.draw_version as number;
  const emailResult: NotifyResult = await notify({
    type: resendEventType(drawVersion),
    groupId,
    groupSlug: slug,
    drawKey: String(drawVersion),
    groupName: group.name as string,
    year: group.year as number,
    adminName: contact?.name ?? null,
    adminEmail: contact?.email ?? null,
    assignments,
  });

  logger
    .withMetadata({
      groupId,
      sent: emailResult.sent,
      failed: emailResult.failed,
    })
    .info("draw.emails_resent");

  const emailsFailed = emailResult.failed + skipped;
  const emailsTotal = emailResult.sent + emailResult.failed + skipped;
  await recordDrawMailResult(
    admin,
    groupId,
    drawVersion,
    emailsFailed,
    emailsTotal,
  );

  return { status: "success", emailsFailed, emailsTotal };
}

export type DismissDrawMailWarningState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: "not_authenticated" | "not_admin" | "generic" };

/** Admin hides the pending draw-mail warning (clears the stored failure). */
export async function dismissDrawMailWarning(
  _prev: DismissDrawMailWarningState,
  formData: FormData,
): Promise<DismissDrawMailWarningState> {
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  if (!slug) return { status: "error", error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", error: "not_authenticated" };

  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("id")
    .eq("slug", slug)
    .single();
  // Same error as "not an admin" so slug existence isn't revealed (#181).
  if (!group) return { status: "error", error: "not_admin" };

  const groupId = group.id as string;

  const { data: callerMembership } = await admin
    .from("memberships")
    .select("id, role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .single();
  if (!callerMembership || callerMembership.role !== "admin") {
    return { status: "error", error: "not_admin" };
  }

  const { error } = await admin
    .from("draw_mail_failures")
    .delete()
    .eq("group_id", groupId);
  if (error) {
    logger
      .withMetadata({ groupId, reason: error.message })
      .error("draw.mail_warning_dismiss_failed");
    return { status: "error", error: "generic" };
  }

  return { status: "success" };
}
