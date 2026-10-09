import { getMessages } from "next-intl/server";
import {
  LeaveGroupDetailProvider,
  LeaveGroupButtonClient,
} from "./leave-button-client";

export async function LeaveGroupButton({
  slug,
  drawn,
}: {
  slug: string;
  drawn: boolean;
}) {
  const messages = await getMessages();
  return (
    <LeaveGroupDetailProvider messages={{ groupDetail: messages.groupDetail }}>
      <LeaveGroupButtonClient slug={slug} drawn={drawn} />
    </LeaveGroupDetailProvider>
  );
}
