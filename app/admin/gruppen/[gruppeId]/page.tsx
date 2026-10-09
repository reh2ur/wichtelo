import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { GroupActions } from "./group-actions";
import { AdminDetailSkeleton, AdminListSkeleton } from "../../admin-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

const MAX_PAGES = 20;
const PER_PAGE = 1000;

interface GroupRecord {
  id: string;
  slug: string;
  name: string;
  year: number;
  state: "open" | "drawn";
  budget_hint: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface MembershipRecord {
  id: string;
  profile_id: string | null;
  name_snapshot: string;
  role: "participant" | "admin";
  joined_at: string;
}

interface AssignmentRecord {
  giver_id: string;
  receiver_id: string;
}

interface ExclusionRecord {
  member_a: string;
  member_b: string;
}

async function fetchGroupDetail(groupId: string) {
  const admin = createAdminClient();

  const { data: groupRaw } = await admin
    .from("groups")
    .select(
      "id, slug, name, year, state, budget_hint, note, created_by, created_at",
    )
    .eq("id", groupId)
    .maybeSingle();
  if (!groupRaw) return null;
  const group = groupRaw as GroupRecord;

  const { data: creatorRaw } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", group.created_by)
    .maybeSingle();
  const creator = creatorRaw as Pick<
    ProfileRow,
    "first_name" | "last_name"
  > | null;

  const { data: membershipsRaw } = await admin
    .from("memberships")
    .select("id, profile_id, name_snapshot, role, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  const memberships = (membershipsRaw ?? []) as MembershipRecord[];
  const nameByMembershipId = new Map(
    memberships.map((m) => [m.id, m.name_snapshot]),
  );

  let emailByProfileId = new Map<string, string>();
  if (memberships.some((m) => m.profile_id)) {
    const authUsers: { id: string; email?: string }[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: PER_PAGE,
      });
      if (error || !data) break;
      authUsers.push(...data.users);
      if (data.users.length < PER_PAGE) break;
    }
    emailByProfileId = new Map(
      authUsers.filter((u) => u.email).map((u) => [u.id, u.email!]),
    );
  }

  const { data: tokenRaw } = await admin
    .from("invite_tokens")
    .select("token")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const inviteToken = (tokenRaw as { token: string } | null)?.token ?? null;

  const { data: assignmentsRaw } = await admin
    .from("assignments")
    .select("giver_id, receiver_id")
    .eq("group_id", groupId);
  const assignments = ((assignmentsRaw ?? []) as AssignmentRecord[]).map(
    (a) => ({
      giverName: nameByMembershipId.get(a.giver_id) ?? "—",
      receiverName: nameByMembershipId.get(a.receiver_id) ?? "—",
    }),
  );

  const { data: exclusionsRaw } = await admin
    .from("exclusions")
    .select("member_a, member_b")
    .eq("group_id", groupId);
  const exclusions = ((exclusionsRaw ?? []) as ExclusionRecord[]).map((e) => ({
    memberAName: nameByMembershipId.get(e.member_a) ?? "—",
    memberBName: nameByMembershipId.get(e.member_b) ?? "—",
  }));

  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    year: group.year,
    state: group.state,
    budgetHint: group.budget_hint,
    note: group.note,
    createdByName: creator
      ? `${creator.first_name} ${creator.last_name}`
      : null,
    createdAt: group.created_at,
    inviteToken,
    members: memberships.map((m) => ({
      id: m.id,
      name: m.name_snapshot,
      email: m.profile_id ? (emailByProfileId.get(m.profile_id) ?? null) : null,
      profileId: m.profile_id,
      role: m.role,
      joinedAt: m.joined_at,
    })),
    assignments,
    exclusions,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function AdminGroupDetailPage(
  props: PageProps<"/admin/gruppen/[gruppeId]">,
) {
  const t = await getTranslations("adminGroups");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/admin/gruppen"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon size={14} />
          {t("detail.backToGroups")}
        </Link>
      </div>

      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-8 w-56" />
            <AdminDetailSkeleton rows={9} />
            <div className="mt-8">
              <AdminListSkeleton rows={3} />
            </div>
          </>
        }
      >
        <AdminGroupDetailContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function AdminGroupDetailContent({
  params,
}: {
  params: Promise<{ gruppeId: string }>;
}) {
  const { gruppeId } = await params;
  const t = await getTranslations("adminGroups");

  const data = await fetchGroupDetail(gruppeId);
  if (!data) notFound();

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{data.name}</h1>

      <section className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.groupInfoSection")}
        </h2>
        <dl className="border-border bg-card grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-4 text-sm">
          <dt className="text-muted-foreground">{t("detail.nameLabel")}</dt>
          <dd>{data.name}</dd>
          <dt className="text-muted-foreground">{t("detail.slugLabel")}</dt>
          <dd className="font-mono text-xs">{data.slug}</dd>
          <dt className="text-muted-foreground">{t("detail.stateLabel")}</dt>
          <dd>
            {data.state === "drawn"
              ? t("table.stateDrawn")
              : t("table.stateOpen")}
          </dd>
          <dt className="text-muted-foreground">{t("detail.yearLabel")}</dt>
          <dd>{data.year}</dd>
          <dt className="text-muted-foreground">
            {t("detail.budgetHintLabel")}
          </dt>
          <dd>{data.budgetHint ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("detail.noteLabel")}</dt>
          <dd>{data.note ?? "—"}</dd>
          <dt className="text-muted-foreground">
            {t("detail.createdByLabel")}
          </dt>
          <dd>{data.createdByName ?? "—"}</dd>
          <dt className="text-muted-foreground">
            {t("detail.createdAtLabel")}
          </dt>
          <dd>{formatDate(data.createdAt)}</dd>
          <dt className="text-muted-foreground">
            {t("detail.inviteTokenLabel")}
          </dt>
          <dd className="font-mono text-xs break-all">
            {data.inviteToken ?? "—"}
          </dd>
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.membersSection")}
        </h2>
        {data.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.membersEmpty")}
          </p>
        ) : (
          <ul className="border-border bg-card divide-y rounded-lg border">
            {data.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div className="flex flex-col">
                  {m.profileId ? (
                    <Link
                      href={`/admin/benutzer/${m.profileId}`}
                      className="text-primary font-medium underline-offset-4 hover:underline"
                    >
                      {m.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{m.name}</span>
                  )}
                  {m.email && (
                    <span className="text-muted-foreground text-xs">
                      {m.email}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground flex items-center gap-4">
                  <span>
                    {m.role === "admin"
                      ? t("detail.roleAdmin")
                      : t("detail.roleParticipant")}
                  </span>
                  <span>{formatDate(m.joinedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.state === "drawn" && (
        <section className="mb-8">
          <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
            {t("detail.assignmentsSection")}
          </h2>
          {data.assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("detail.assignmentsEmpty")}
            </p>
          ) : (
            <ul className="border-border bg-card divide-y rounded-lg border">
              {data.assignments.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span>{a.giverName}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>{a.receiverName}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.exclusionsSection")}
        </h2>
        {data.exclusions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.exclusionsEmpty")}
          </p>
        ) : (
          <ul className="border-border bg-card divide-y rounded-lg border">
            {data.exclusions.map((e, i) => (
              <li
                key={i}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span>{e.memberAName}</span>
                <span className="text-muted-foreground">×</span>
                <span>{e.memberBName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("detail.actionsSection")}
        </h2>
        <GroupActions groupId={data.id} state={data.state} />
      </section>
    </>
  );
}
