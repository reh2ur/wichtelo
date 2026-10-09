export interface Member {
  id: string;
  firstName: string;
  lastName: string;
}

export interface DisplayName {
  id: string;
  displayName: string;
}

export interface MembershipLike {
  id: string;
  name_snapshot: string;
  /** Separately stored names; preferred over splitting name_snapshot. */
  first_name_snapshot?: string | null;
  last_name_snapshot?: string | null;
  profile_id: string | null;
}

export interface ProfileLike {
  first_name: string;
  last_name: string;
}

/**
 * Converts membership rows into abbreviateNames() input. Prefers the linked
 * profile's first/last name; then the separately stored first/last snapshot
 * (survives account deletion unchanged); and only as a last resort, for legacy
 * rows, splits name_snapshot on the first space.
 */
export function membersFromMemberships(
  memberships: MembershipLike[],
  profilesById: Map<string, ProfileLike>,
): Member[] {
  return memberships.map((m) => {
    const profile = m.profile_id ? profilesById.get(m.profile_id) : undefined;
    if (profile) {
      return {
        id: m.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
      };
    }
    if (m.first_name_snapshot != null) {
      return {
        id: m.id,
        firstName: m.first_name_snapshot,
        lastName: m.last_name_snapshot ?? "",
      };
    }
    const parts = m.name_snapshot.trim().split(/\s+/);
    return {
      id: m.id,
      firstName: parts[0] ?? m.name_snapshot,
      lastName: parts.slice(1).join(" "),
    };
  });
}

/**
 * Produces display names with last names abbreviated to the minimum number of
 * characters needed for uniqueness within the group.
 *
 * Rules:
 *   - If every first name in the group is unique, last names are omitted entirely.
 *   - Otherwise, every member that shares a first name with at least one other
 *     member gets a last-name suffix. The suffix length per first-name cohort
 *     is the smallest prefix length that yields unique values within that cohort.
 *   - Members whose first name is unique within the group are still rendered
 *     with first name only, even when other cohorts collide.
 */
export function abbreviateNames(members: Member[]): DisplayName[] {
  if (members.length === 0) return [];

  const cohorts = new Map<string, Member[]>();
  for (const m of members) {
    const cohort = cohorts.get(m.firstName);
    if (cohort) {
      cohort.push(m);
    } else {
      cohorts.set(m.firstName, [m]);
    }
  }

  const suffixById = new Map<string, string>();

  for (const cohort of cohorts.values()) {
    if (cohort.length === 1) continue;

    for (const member of cohort) {
      const others = cohort.filter((c) => c.id !== member.id);
      suffixById.set(
        member.id,
        minimumDistinguishingPrefix(
          member.lastName,
          others.map((o) => o.lastName),
        ),
      );
    }
  }

  const result = members.map((m) => {
    const suffix = suffixById.get(m.id);
    return {
      id: m.id,
      displayName: suffix ? `${m.firstName} ${suffix}.` : m.firstName,
    };
  });

  // Identical names (same full name, or same first name with empty last
  // names) still collide: number them so every display name is unique.
  const counts = new Map<string, number>();
  for (const r of result) {
    counts.set(r.displayName, (counts.get(r.displayName) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return result.map((r) => {
    if ((counts.get(r.displayName) ?? 0) < 2) return r;
    const n = (seen.get(r.displayName) ?? 0) + 1;
    seen.set(r.displayName, n);
    return { id: r.id, displayName: `${r.displayName} (${n})` };
  });
}

/** Splits into user-perceived characters so emoji / non-BMP are never cut. */
function graphemes(str: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(str), (x) => x.segment);
  }
  return Array.from(str);
}

/**
 * Returns the shortest prefix of `target` that does not appear as a prefix of
 * any string in `others`. Falls back to the full `target` if no such prefix
 * exists (e.g., two members share identical last names).
 */
function minimumDistinguishingPrefix(target: string, others: string[]): string {
  const chars = graphemes(target);
  for (let len = 1; len <= chars.length; len++) {
    const prefix = chars.slice(0, len).join("");
    const collides = others.some((o) => o.startsWith(prefix));
    if (!collides) return prefix;
  }
  return target;
}
