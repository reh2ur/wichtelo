import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { fetchAuditLog } from "@/lib/admin/audit-log";
import { AuditTable } from "./audit-table";
import { AdminListSkeleton } from "../admin-skeletons";

export default async function AdminAuditLogPage() {
  const t = await getTranslations("adminAuditLog");

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/admin"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon size={14} />
          {t("backToAdmin")}
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>

      <Suspense fallback={<AdminListSkeleton />}>
        <AdminAuditLogContent />
      </Suspense>
    </main>
  );
}

async function AdminAuditLogContent() {
  await connection();
  const entries = await fetchAuditLog();

  return <AuditTable entries={entries} />;
}
