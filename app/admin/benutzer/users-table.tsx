import { getMessages } from "next-intl/server";
import {
  UsersTableProvider,
  UsersTableClient,
  type UserRow,
} from "./users-table-client";

export async function UsersTable({ users }: { users: UserRow[] }) {
  const messages = await getMessages();
  return (
    <UsersTableProvider messages={{ adminUsers: messages.adminUsers }}>
      <UsersTableClient users={users} />
    </UsersTableProvider>
  );
}
