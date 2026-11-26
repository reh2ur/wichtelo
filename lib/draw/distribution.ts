import type { createAdminClient } from "@/lib/supabase/admin";
import { loadMemberships } from "@/lib/draw";
import { pseudonymize } from "./pseudonyms";
import { verifyDistribution } from "./verify";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DistributionNode {
  label: string;
  /** The viewing admin; the only node that carries a real name. */
  isMe: boolean;
  /** Deleted account (membership kept after the draw). */
  ghost: boolean;
  name?: string;
}

interface DistributionArrow {
  from: string;
  to: string;
}

/** `DistributionCheck` with member ids replaced by pseudonym labels. */
interface DistributionCheckView {
  missingGiver: string[];
  multipleGiver: string[];
  missingReceiver: string[];
  multipleReceiver: string[];
  selfAssigned: string[];
  mutualPairs: [string, string][];
  exclusionViolations: [string, string][];
  unknownEndpoints: number;
  exclusionCount: number;
  ok: boolean;
}

export interface DistributionView {
  nodes: DistributionNode[];
  arrows: DistributionArrow[];
  check: DistributionCheckView;
}

/**
 * Pseudonymised view model of a drawn group for the admin check page. No
 * membership id and no name except the caller's own leaves this function, so
 * the result is safe to hand to a client component. Throws on any DB error
 * (a failed read must never look like "no assignments").
 */
export async function loadDistribution(
  admin: AdminClient,
  group: { id: string; draw_version: number },
  me: { id: string; name_snapshot: string },
): Promise<DistributionView> {
  const [members, assignmentsRes, exclusionsRes] = await Promise.all([
    loadMemberships(admin, group.id),
    admin
      .from("assignments")
      .select("giver_id, receiver_id")
      .eq("group_id", group.id),
    admin
      .from("exclusions")
      .select("member_a, member_b")
      .eq("group_id", group.id),
  ]);
  if (assignmentsRes.error) {
    throw new Error(`assignments load failed: ${assignmentsRes.error.message}`);
  }
  if (exclusionsRes.error) {
    throw new Error(`exclusions load failed: ${exclusionsRes.error.message}`);
  }

  const memberIds = members.map((m) => m.id);
  const pairs = (assignmentsRes.data ?? []).map((a) => ({
    giver: a.giver_id,
    receiver: a.receiver_id,
  }));
  const exclusions = (exclusionsRes.data ?? []).map(
    (e) => [e.member_a, e.member_b] as [string, string],
  );

  const { labelById } = pseudonymize(group.id, group.draw_version, memberIds);
  const label = (id: string) => labelById.get(id)!;
  const labels = (ids: string[]) => ids.map(label).sort(compareLabels);
  const labelPairs = (list: [string, string][]) =>
    list
      .map(
        ([a, b]) =>
          [label(a), label(b)].sort(compareLabels) as [string, string],
      )
      .sort((x, y) => compareLabels(x[0], y[0]) || compareLabels(x[1], y[1]));

  const check = verifyDistribution({ memberIds, pairs, exclusions });

  const nodes = members
    .map<DistributionNode>((m) => ({
      label: label(m.id),
      isMe: m.id === me.id,
      ghost: m.profile_id === null,
      ...(m.id === me.id ? { name: me.name_snapshot } : {}),
    }))
    .sort((a, b) => compareLabels(a.label, b.label));

  const arrows = pairs
    .filter((p) => labelById.has(p.giver) && labelById.has(p.receiver))
    .map((p) => ({ from: label(p.giver), to: label(p.receiver) }))
    .sort((a, b) => compareLabels(a.from, b.from));

  return {
    nodes,
    arrows,
    check: {
      missingGiver: labels(check.missingGiver),
      multipleGiver: labels(check.multipleGiver),
      missingReceiver: labels(check.missingReceiver),
      multipleReceiver: labels(check.multipleReceiver),
      selfAssigned: labels(check.selfAssigned),
      mutualPairs: labelPairs(check.mutualPairs),
      exclusionViolations: labelPairs(check.exclusionViolations),
      unknownEndpoints: check.unknownEndpoints.length,
      exclusionCount: check.exclusionCount,
      ok: check.ok,
    },
  };
}

/** A < B < … < Z < AA < AB: shorter first, then alphabetical. */
function compareLabels(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
