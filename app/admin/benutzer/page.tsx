import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllAuthUsers } from "@/lib/admin/auth-users";
import { fetchAllRows } from "@/lib/admin/paged";
import { UsersTable } from "./users-table";
import type { UserRow } from "./users-table-client";
import { AdminListSkeleton } from "../admin-skeletons";

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface MembershipRow {
  id: string;
  profile_id: string | null;
}

async function fetchUsers(): Promise<UserRow[]> {
  const admin = createAdminClient();

  const [authUsers, profiles, memberships] = await Promise.all([
    listAllAuthUsers(admin),
    fetchAllRows<ProfileRow>("admin.users.profiles", (from, to) =>
      admin
        .from("profiles")
        .select("id, first_name, last_name")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<MembershipRow>("admin.users.memberships", (from, to) =>
      admin
        .from("memberships")
        .select("id, profile_id")
        .order("id")
        .range(from, to),
    ),
  ]);

  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const groupCountByProfileId = new Map<string, number>();
  for (const m of memberships) {
    if (!m.profile_id) continue;
    groupCountByProfileId.set(
      m.profile_id,
      (groupCountByProfileId.get(m.profile_id) ?? 0) + 1,
    );
  }

  return authUsers.map((u) => {
    const profile = profilesById.get(u.id);
    const banned = !!u.banned_until && new Date(u.banned_until) > new Date();
    return {
      id: u.id,
      email: u.email ?? "",
      fullName: profile ? `${profile.first_name} ${profile.last_name}` : null,
      createdAt: u.created_at,
      groupCount: groupCountByProfileId.get(u.id) ?? 0,
      lastSignInAt: u.last_sign_in_at ?? null,
      banned,
    };
  });
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers");
  return { title: t("title") };
}

export default async function AdminUsersPage() {
  const t = await getTranslations("adminUsers");

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
        <AdminUsersContent />
      </Suspense>
    </main>
  );
}

async function AdminUsersContent() {
  await connection();
  const users = await fetchUsers();

  return <UsersTable users={users} />;
}
