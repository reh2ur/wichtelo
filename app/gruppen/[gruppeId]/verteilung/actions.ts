"use server";

import { requireGroupAdmin } from "@/lib/group-admin";
import { loadMemberships } from "@/lib/draw";
import { pseudonymize } from "@/lib/draw/pseudonyms";
import { loadProfilesById } from "@/lib/member-display-names";
import { checkRateLimit, identityRevealLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export type RevealState =
  | { status: "success"; label: string; name: string }
  | {
      status: "error";
      error:
        | "not_authenticated"
        | "not_admin"
        | "not_found"
        | "rate_limited"
        | "generic";
    };

/**
 * Reveals the real name behind one pseudonym of the distribution view (#223).
 * Admin only, drawn groups only, rate-limited, and the audit row is written
 * BEFORE the name leaves the server (fail closed), same contract as
 * `lookupAssignment`.
 */
export async function revealMemberName(
  slug: string,
  label: string,
): Promise<RevealState> {
  const cleanSlug = slug.trim();
  const cleanLabel = label.trim();
  if (!cleanSlug || !/^[A-Z]{1,4}$/.test(cleanLabel)) {
    return { status: "error", error: "generic" };
  }

  const guard = await requireGroupAdmin(cleanSlug);
  if (!guard.ok) {
    // Unknown slug = same code as non-admin: no slug-existence oracle (#181).
    return {
      status: "error",
      error: guard.error === "group_not_found" ? "not_admin" : guard.error,
    };
  }
  const { user, admin, group } = guard;

  if (
    !(await checkRateLimit(identityRevealLimiter, `${cleanSlug}:${user.id}`))
  ) {
    return { status: "error", error: "rate_limited" };
  }

  if (group.state !== "drawn") return { status: "error", error: "not_found" };

  try {
    const members = await loadMemberships(admin, group.id);
    const { idByLabel } = pseudonymize(
      group.id,
      group.draw_version,
      members.map((m) => m.id),
    );
    const membershipId = idByLabel.get(cleanLabel);
    const member = members.find((m) => m.id === membershipId);
    if (!member) return { status: "error", error: "not_found" };

    const { error: auditError } = await admin
      .from("assignment_lookups")
      .insert({
        group_id: group.id,
        actor_profile_id: user.id,
        target_membership_id: member.id,
        kind: "identity",
      });
    if (auditError) {
      logger
        .withMetadata({ groupId: group.id, reason: auditError.message })
        .error("admin.identity_reveal_audit_failed");
      return { status: "error", error: "generic" };
    }

    let name = member.name_snapshot;
    if (member.profile_id) {
      const profiles = await loadProfilesById(admin, [member]);
      const p = profiles.get(member.profile_id);
      if (p) name = `${p.first_name} ${p.last_name}`;
    }

    logger
      .withMetadata({
        groupId: group.id,
        targetId: member.id,
        actorId: user.id,
      })
      .info("admin.identity_reveal");

    return { status: "success", label: cleanLabel, name };
  } catch (err) {
    logger
      .withMetadata({
        groupId: group.id,
        reason: err instanceof Error ? err.message : String(err),
      })
      .error("admin.identity_reveal_failed");
    return { status: "error", error: "generic" };
  }
}
