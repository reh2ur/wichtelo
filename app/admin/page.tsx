import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllAuthUsers } from "@/lib/admin/auth-users";
import { fetchAuditLog, resolveTargetHref } from "@/lib/admin/audit-log";
import { AdminStatsSkeleton, AdminListSkeleton } from "./admin-skeletons";

async function fetchStats() {
  const admin = createAdminClient();

  const authUsers = await listAllAuthUsers(admin);
  const totalUsers = authUsers.length;

  const { count: totalGroups } = await admin
    .from("groups")
    .select("id", { count: "exact", head: true });
  const { count: openGroups } = await admin
    .from("groups")
    .select("id", { count: "exact", head: true })
    .eq("state", "open");
  const { count: drawnGroups } = await admin
    .from("groups")
    .select("id", { count: "exact", head: true })
    .eq("state", "drawn");

  return {
    totalUsers,
    totalGroups: totalGroups ?? 0,
    openGroups: openGroups ?? 0,
    drawnGroups: drawnGroups ?? 0,
  };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminPage() {
  const t = await getTranslations("admin");

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>

      <Suspense
        fallback={
          <>
            <AdminStatsSkeleton />
            <AdminListSkeleton />
          </>
        }
      >
        <AdminContent />
      </Suspense>
    </main>
  );
}

async function AdminContent() {
  await connection();
  const t = await getTranslations("admin");
  const tAuditLog = await getTranslations("adminAuditLog");
  const [stats, recentActivity] = await Promise.all([
    fetchStats(),
    fetchAuditLog(10),
  ]);

  const statCards = [
    { label: t("stats.totalUsers"), value: stats.totalUsers },
    { label: t("stats.totalGroups"), value: stats.totalGroups },
    { label: t("stats.openGroups"), value: stats.openGroups },
    { label: t("stats.drawnGroups"), value: stats.drawnGroups },
  ];

  return (
    <>
      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="border-border bg-card rounded-lg border p-4"
          >
            <p className="text-muted-foreground text-xs">{card.label}</p>
            <p className="mt-1 text-2xl font-bold">{card.value}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            {t("recentActivity.title")}
          </h2>
          <Link
            href="/admin/audit-log"
            className="text-primary text-sm underline-offset-4 hover:underline"
          >
            {t("recentActivity.viewAll")}
          </Link>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("recentActivity.empty")}
          </p>
        ) : (
          <ul className="border-border bg-card divide-y rounded-lg border">
            {recentActivity.map((entry) => {
              const href = resolveTargetHref(entry);
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span className="text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </span>
                  <span>{tAuditLog(`actions.${entry.action}`)}</span>
                  {href ? (
                    <Link
                      href={href}
                      className="text-primary font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {entry.targetId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground font-mono text-xs">
                      {entry.targetId}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
