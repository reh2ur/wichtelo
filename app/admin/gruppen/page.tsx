import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { GroupsTable } from "./groups-table";
import type { GroupRow } from "./groups-table-client";
import { AdminListSkeleton } from "../admin-skeletons";

interface GroupRecord {
  id: string;
  slug: string;
  name: string;
  state: "open" | "drawn";
  created_by: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface MembershipRow {
  group_id: string;
}

async function fetchGroups(): Promise<GroupRow[]> {
  const admin = createAdminClient();

  const { data: groupsRaw } = await admin
    .from("groups")
    .select("id, slug, name, state, created_by, created_at");
  const groups = (groupsRaw ?? []) as GroupRecord[];

  const { data: profilesRaw } = await admin
    .from("profiles")
    .select("id, first_name, last_name");
  const profilesById = new Map(
    ((profilesRaw ?? []) as ProfileRow[]).map((p) => [p.id, p]),
  );

  const { data: membershipsRaw } = await admin
    .from("memberships")
    .select("group_id");
  const memberCountByGroupId = new Map<string, number>();
  for (const m of (membershipsRaw ?? []) as MembershipRow[]) {
    memberCountByGroupId.set(
      m.group_id,
      (memberCountByGroupId.get(m.group_id) ?? 0) + 1,
    );
  }

  return groups.map((g) => {
    const creator = profilesById.get(g.created_by);
    return {
      id: g.id,
      name: g.name,
      slug: g.slug,
      state: g.state,
      memberCount: memberCountByGroupId.get(g.id) ?? 0,
      createdByName: creator
        ? `${creator.first_name} ${creator.last_name}`
        : null,
      createdByUserId: g.created_by,
      createdAt: g.created_at,
    };
  });
}

export default async function AdminGroupsPage() {
  const t = await getTranslations("adminGroups");

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
        <AdminGroupsContent />
      </Suspense>
    </main>
  );
}

async function AdminGroupsContent() {
  await connection();
  const groups = await fetchGroups();

  return <GroupsTable groups={groups} />;
}
