export const groupTag = (slug: string) => `group-${slug}`;
/** @public Reserved: no cacheTag consumer yet (see CLAUDE.md). */
export const inviteTag = (token: string) => `invite-${token}`;
/** Per-user wishes. Nothing cached; `updateTag` = action-response refresh trigger. */
export const wishesTag = (profileId: string) => `wishes-${profileId}`;
