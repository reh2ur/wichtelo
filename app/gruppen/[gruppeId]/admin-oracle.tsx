import { getMessages } from "next-intl/server";
import {
  OracleProvider,
  AdminOracleClient,
  type Member,
} from "./admin-oracle-client";

export type { Member };

export async function AdminOracle({
  slug,
  members,
}: {
  slug: string;
  members: Member[];
}) {
  const messages = await getMessages();
  return (
    <OracleProvider messages={{ oracle: messages.oracle }}>
      <AdminOracleClient slug={slug} members={members} />
    </OracleProvider>
  );
}
