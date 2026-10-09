import { getMessages } from "next-intl/server";
import {
  GroupActionsProvider,
  GroupActionsClient,
} from "./group-actions-client";

export async function GroupActions({
  groupId,
  state,
}: {
  groupId: string;
  state: "open" | "drawn";
}) {
  const messages = await getMessages();
  return (
    <GroupActionsProvider messages={{ adminGroups: messages.adminGroups }}>
      <GroupActionsClient groupId={groupId} state={state} />
    </GroupActionsProvider>
  );
}
