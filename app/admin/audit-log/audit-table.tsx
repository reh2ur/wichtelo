import { getMessages } from "next-intl/server";
import { resolveTargetHref, type AuditLogEntry } from "@/lib/admin/audit-log";
import {
  AuditTableProvider,
  AuditTableClient,
  type AuditRow,
} from "./audit-table-client";

export async function AuditTable({ entries }: { entries: AuditLogEntry[] }) {
  const messages = await getMessages();
  const rows: AuditRow[] = entries.map((entry) => ({
    ...entry,
    targetHref: resolveTargetHref(entry),
  }));
  return (
    <AuditTableProvider messages={{ adminAuditLog: messages.adminAuditLog }}>
      <AuditTableClient entries={rows} />
    </AuditTableProvider>
  );
}
