import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsersTable } from "./users-table";
import type { UserRow } from "./users-table-client";
import { AdminListSkeleton } from "../admin-skeletons";

const MAX_PAGES = 20;
const PER_PAGE = 1000;

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface MembershipRow {
  profile_id: string | null;
}

async function fetchUsers(): Promise<UserRow[]> {
  const admin = createAdminClient();

  const authUsers: {
    id: string;
    email?: string;
    created_at: string;
    last_sign_in_at?: string | null;
    banned_until?: string | null;
  }[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error || !data) break;
    authUsers.push(...data.users);
    if (data.users.length < PER_PAGE) break;
  }

  const { data: profilesRaw } = await admin
    .from("profiles")
    .select("id, first_name, last_name");
  const profilesById = new Map(
    ((profilesRaw ?? []) as ProfileRow[]).map((p) => [p.id, p]),
  );

  const { data: membershipsRaw } = await admin
    .from("memberships")
    .select("profile_id");
  const groupCountByProfileId = new Map<string, number>();
  for (const m of (membershipsRaw ?? []) as MembershipRow[]) {
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
