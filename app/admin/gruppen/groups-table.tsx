import { getMessages } from "next-intl/server";
import {
  GroupsTableProvider,
  GroupsTableClient,
  type GroupRow,
} from "./groups-table-client";

export async function GroupsTable({ groups }: { groups: GroupRow[] }) {
  const messages = await getMessages();
  return (
    <GroupsTableProvider messages={{ adminGroups: messages.adminGroups }}>
      <GroupsTableClient groups={groups} />
    </GroupsTableProvider>
  );
}
