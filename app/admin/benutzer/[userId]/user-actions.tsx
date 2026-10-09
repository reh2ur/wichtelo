import { getMessages } from "next-intl/server";
import { UserActionsProvider, UserActionsClient } from "./user-actions-client";

export async function UserActions({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const messages = await getMessages();
  return (
    <UserActionsProvider messages={{ adminUsers: messages.adminUsers }}>
      <UserActionsClient userId={userId} banned={banned} />
    </UserActionsProvider>
  );
}
