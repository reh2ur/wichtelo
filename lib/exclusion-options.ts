export interface ExclusionPair {
  memberA: string;
  memberB: string;
}

/**
 * Member ids selectable as partner of `selectedId`: not itself, not already
 * excluded with it (pairs bidirectional → compared unordered). UX only; server
 * duplicate check stays the guarantee.
 */
export function availablePartnerIds(
  memberIds: string[],
  exclusions: ExclusionPair[],
  selectedId: string,
): string[] {
  if (!selectedId) return memberIds;
  const taken = new Set<string>([selectedId]);
  for (const ex of exclusions) {
    if (ex.memberA === selectedId) taken.add(ex.memberB);
    else if (ex.memberB === selectedId) taken.add(ex.memberA);
  }
  return memberIds.filter((id) => !taken.has(id));
}

/** Members who can still be paired with at least one other member. */
export function pairableIds(
  memberIds: string[],
  exclusions: ExclusionPair[],
): string[] {
  return memberIds.filter(
    (id) => availablePartnerIds(memberIds, exclusions, id).length > 0,
  );
}
