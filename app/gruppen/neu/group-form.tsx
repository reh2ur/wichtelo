import { getMessages } from "next-intl/server";
import { CreateGroupProvider, GroupFormClient } from "./group-form-client";

export async function GroupForm({
  hasProfile,
  currentYear,
}: {
  hasProfile: boolean;
  currentYear: number;
}) {
  const messages = await getMessages();
  return (
    <CreateGroupProvider messages={{ createGroup: messages.createGroup }}>
      <GroupFormClient hasProfile={hasProfile} currentYear={currentYear} />
    </CreateGroupProvider>
  );
}
