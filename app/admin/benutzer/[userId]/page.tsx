import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserActions } from "./user-actions";
import { AdminDetailSkeleton, AdminListSkeleton } from "../../admin-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

interface ProfileRow {
  first_name: string;
  last_name: string;
}

interface GroupRow {
  name: string;
  slug: string;
}

interface MembershipRow {
  id: string;
  role: "participant" | "admin";
  joined_at: string;
  groups: GroupRow | null;
}

async function fetchUserDetail(userId: string) {
  const admin = createAdminClient();

  const { data: userData, error } = await admin.auth.admin.getUserById(userId);
  if (error || !userData?.user) return null;

  const { data: profileRaw } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  const profile = profileRaw as ProfileRow | null;

  const { data: membershipsRaw } = await admin
    .from("memberships")
    .select("id, role, joined_at, groups(name, slug)")
    .eq("profile_id", userId)
    .order("joined_at", { ascending: true });

  const banned =
    !!userData.user.banned_until &&
    new Date(userData.user.banned_until) > new Date();

  return {
    id: userData.user.id,
    email: userData.user.email ?? "",
    fullName: profile ? `${profile.first_name} ${profile.last_name}` : null,
    createdAt: userData.user.created_at,
    lastSignInAt: userData.user.last_sign_in_at ?? null,
    banned,
    memberships: (membershipsRaw ?? []) as unknown as MembershipRow[],
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function AdminUserDetailPage(
  props: PageProps<"/admin/benutzer/[userId]">,
) {
  const t = await getTranslations("adminUsers");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/admin/benutzer"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon size={14} />
          {t("detail.backToUsers")}
        </Link>
      </div>

      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-8 w-56" />
            <AdminDetailSkeleton />
            <div className="mt-8">
              <AdminListSkeleton rows={2} />
            </div>
          </>
        }
      >
        <AdminUserDetailContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function AdminUserDetailContent({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const t = await getTranslations("adminUsers");

  const data = await fetchUserDetail(userId);
  if (!data) notFound();

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{data.email}</h1>

      <section className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.profileSection")}
        </h2>
        <dl className="border-border bg-card grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-4 text-sm">
          <dt className="text-muted-foreground">{t("detail.emailLabel")}</dt>
          <dd>{data.email}</dd>
          <dt className="text-muted-foreground">{t("detail.nameLabel")}</dt>
          <dd>{data.fullName ?? "—"}</dd>
          <dt className="text-muted-foreground">
            {t("detail.createdAtLabel")}
          </dt>
          <dd>{formatDate(data.createdAt)}</dd>
          <dt className="text-muted-foreground">
            {t("detail.lastSignInLabel")}
          </dt>
          <dd>
            {data.lastSignInAt
              ? formatDate(data.lastSignInAt)
              : t("table.never")}
          </dd>
          <dt className="text-muted-foreground">{t("detail.statusLabel")}</dt>
          <dd>
            {data.banned ? t("table.statusBanned") : t("table.statusActive")}
          </dd>
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.groupsSection")}
        </h2>
        {data.memberships.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.groupsEmpty")}
          </p>
        ) : (
          <ul className="border-border bg-card divide-y rounded-lg border">
            {data.memberships.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span className="font-medium">{m.groups?.name ?? "—"}</span>
                <div className="text-muted-foreground flex items-center gap-4">
                  <span>
                    {m.role === "admin"
                      ? t("detail.roleAdmin")
                      : t("detail.roleParticipant")}
                  </span>
                  <span>{formatDate(m.joined_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.actionsSection")}
        </h2>
        <UserActions userId={data.id} banned={data.banned} />
      </section>
    </>
  );
}
