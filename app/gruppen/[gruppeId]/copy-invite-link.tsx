import { getMessages } from "next-intl/server";
import {
  GroupDetailProvider,
  CopyInviteLinkClient,
} from "./copy-invite-link-client";

export async function CopyInviteLink({ inviteUrl }: { inviteUrl: string }) {
  const messages = await getMessages();
  return (
    <GroupDetailProvider messages={{ groupDetail: messages.groupDetail }}>
      <CopyInviteLinkClient inviteUrl={inviteUrl} />
    </GroupDetailProvider>
  );
}
