"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { groupTag } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeDraw,
  hasGhostMembers,
  type Assignment,
  type ExclusionPair,
} from "@/lib/draw";
import {
  abbreviateNames,
  membersFromMemberships,
} from "@/lib/name-abbreviator";
import { getGroupAdminEmails, resolveGroupContact } from "@/lib/group-admins";
import {
  notify,
  type DrawAssignmentRecipient,
  type NotifyResult,
} from "@/lib/notification";
import { logger } from "@/lib/logger";
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
        | "group_not_found"
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

  if (!group) return { status: "error", error: "group_not_found" };

  // Leaving after draw would cascade-delete assignment rows and break the draw.
  if ((group as { state: string }).state === "drawn") {
    return { status: "error", error: "already_drawn" };
  }

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

  const membership = callerMembership as {
    id: string;
    role: string;
    name_snapshot: string;
  };

  if (membership.role === "admin") {
    const { data: allAdmins } = await admin
      .from("memberships")
      .select("id")
      .eq("group_id", groupId)
      .eq("role", "admin")
      .not("profile_id", "is", null);

    if ((allAdmins ?? []).length <= 1) {
      return { status: "error", error: "last_admin" };
    }
  }

  const { error } = await admin
    .from("memberships")
    .delete()
    .eq("id", membership.id);

  if (error) {
    logger
      .withMetadata({
        groupId,
        membershipId: membership.id,
        reason: error.message,
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
      postDraw: (group as { state: string }).state === "drawn",
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
        | "ghost_members"
        | "generic"
        | "rate_limited";
    };

interface MembershipRow {
  id: string;
  role: "participant" | "admin";
  profile_id: string | null;
  name_snapshot: string;
}

interface ExclusionRow {
  member_a: string;
  member_b: string;
}

/**
 * Builds the per-participant email recipient list for a draw/re-draw:
 * resolves each giver's email address and each receiver's abbreviated
 * display name (same abbreviation shown on the group page).
 */
async function buildDrawAssignmentRecipients(
  admin: ReturnType<typeof createAdminClient>,
  memberRows: MembershipRow[],
  assignment: Assignment,
): Promise<DrawAssignmentRecipient[]> {
  const profileIds = memberRows
    .map((m) => m.profile_id)
    .filter((id): id is string => !!id);

  const profilesById = new Map<
    string,
    { first_name: string; last_name: string }
  >();
  if (profileIds.length > 0) {
    const { data } = await admin
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", profileIds);
    for (const p of (data ?? []) as {
      id: string;
      first_name: string;
      last_name: string;
    }[]) {
      profilesById.set(p.id, p);
    }
  }

  const receiverDisplayById = new Map(
    abbreviateNames(membersFromMemberships(memberRows, profilesById)).map(
      (d) => [d.id, d.displayName],
    ),
  );

  const emailByMembershipId = new Map<string, string>();
  // Parallel lookups: sequential getUserById per member risks serverless timeouts.
  await Promise.all(
    memberRows.map(async (m) => {
      if (!m.profile_id) return;
      const { data: userData } = await admin.auth.admin.getUserById(
        m.profile_id,
      );
      if (userData?.user?.email) {
        emailByMembershipId.set(m.id, userData.user.email);
      }
    }),
  );

  const memberById = new Map(memberRows.map((m) => [m.id, m]));
  const recipients: DrawAssignmentRecipient[] = [];
  for (const [giverId, receiverId] of assignment.entries()) {
    const to = emailByMembershipId.get(giverId);
    const receiverDisplayName = receiverDisplayById.get(receiverId);
    if (!to || !receiverDisplayName) continue;
    recipients.push({
      to,
      giverName: memberById.get(giverId)?.name_snapshot ?? "",
      receiverDisplayName,
    });
  }
  return recipients;
}

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

  const { data: memberships } = await admin
    .from("memberships")
    .select("id, role, profile_id, name_snapshot")
    .eq("group_id", groupId);

  const memberRows: MembershipRow[] = (memberships ?? []) as MembershipRow[];

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

  const { data: exclusionsRaw } = await admin
    .from("exclusions")
    .select("member_a, member_b")
    .eq("group_id", groupId);

  const exclusions: ExclusionPair[] = (
    (exclusionsRaw ?? []) as ExclusionRow[]
  ).map((e) => [e.member_a, e.member_b]);

  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.triggered");

  const memberIds = memberRows.map((m) => m.id);
  const assignment = computeDraw(memberIds, exclusions);

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

  logger
    .withMetadata({ groupId, from: "open", to: "drawn" })
    .info("group.state_changed");
  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.succeeded");

  const contact = await resolveGroupContact(admin, groupId, user.id);
  const assignments = await buildDrawAssignmentRecipients(
    admin,
    memberRows,
    assignment,
  );
  const emailResult: NotifyResult = await notify({
    type: "draw.completed",
    groupId,
    drawKey: String(group.draw_version),
    groupName: group.name as string,
    groupSlug: slug,
    year: group.year as number,
    adminName: contact?.name ?? null,
    adminEmail: contact?.email ?? null,
    assignments,
  });

  updateTag(groupTag(slug));

  return {
    status: "success",
    emailsFailed: emailResult.failed,
    emailsTotal: emailResult.sent + emailResult.failed,
  };
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

  const { data: memberships } = await admin
    .from("memberships")
    .select("id, role, profile_id, name_snapshot")
    .eq("group_id", groupId);

  const memberRows: MembershipRow[] = (memberships ?? []) as MembershipRow[];

  if (memberRows.length < 3) {
    logger
      .withMetadata({ groupId, participantCount: memberRows.length })
      .error("draw.retrigger_failed");
    return { status: "error", error: "not_enough_members" };
  }

  const { data: exclusionsRaw } = await admin
    .from("exclusions")
    .select("member_a, member_b")
    .eq("group_id", groupId);

  const exclusions: ExclusionPair[] = (
    (exclusionsRaw ?? []) as ExclusionRow[]
  ).map((e) => [e.member_a, e.member_b]);

  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.retrigger_triggered");

  const memberIds = memberRows.map((m) => m.id);
  const assignment = computeDraw(memberIds, exclusions);

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
    return { status: "error", error: "generic" };
  }

  logger
    .withMetadata({ groupId, participantCount: memberRows.length })
    .info("draw.retrigger_succeeded");

  const contact = await resolveGroupContact(admin, groupId, user.id);
  const assignments = await buildDrawAssignmentRecipients(
    admin,
    memberRows,
    assignment,
  );
  const emailResult: NotifyResult = await notify({
    type: "draw.redrawn",
    groupId,
    drawKey: String(group.draw_version),
    groupName: group.name as string,
    groupSlug: slug,
    year: group.year as number,
    adminName: contact?.name ?? null,
    adminEmail: contact?.email ?? null,
    assignments,
  });

  updateTag(groupTag(slug));

  return {
    status: "success",
    emailsFailed: emailResult.failed,
    emailsTotal: emailResult.sent + emailResult.failed,
  };
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

  if (!group) return { status: "error", error: "not_found" };

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
