import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { groupTag } from "@/lib/cache-tags";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon, InfoIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { getOrCreateToken } from "@/lib/invite";
import { buildInviteUrl, getSiteUrl } from "@/lib/site-url";
import {
  abbreviateNames,
  membersFromMemberships,
} from "@/lib/name-abbreviator";
import { CopyInviteLink } from "./copy-invite-link";
import { DrawButton } from "./draw-button";
import { RedrawButton } from "./redraw-button";
import { AdminOracle } from "./admin-oracle";
import { LeaveGroupButton } from "./leave-button";
import { GroupDetailSkeleton } from "./group-detail-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";

type GroupState = "open" | "drawn";
type MemberRole = "participant" | "admin";

interface Group {
  id: string;
  slug: string;
  name: string;
  year: number;
  state: GroupState;
  budget_hint: string | null;
  note: string | null;
}

interface Member {
  id: string;
  name_snapshot: string;
  first_name_snapshot: string | null;
  last_name_snapshot: string | null;
  role: MemberRole;
  profile_id: string | null;
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

function StateBadge({
  state,
  t,
}: {
  state: GroupState;
  t: { open: string; drawn: string };
}) {
  const isOpen = state === "open";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        isOpen ? "bg-success/10 text-success" : "bg-crimson/10 text-crimson",
      ].join(" ")}
    >
      <span
        className={[
          "h-1.5 w-1.5 rounded-full",
          isOpen ? "bg-success" : "bg-crimson",
        ].join(" ")}
      />
      {isOpen ? t.open : t.drawn}
    </span>
  );
}

// Blocking route: existence + membership checks run before streaming so
// unknown groups and non-members get a real 404 status. The actual real-404
// guarantee comes from proxy.ts (lib/supabase/proxy.ts), which rewrites
// unknown slugs / non-members before any rendering starts — this check is
// defense in depth for direct hits that somehow bypass that.
export const instant = false;

export default async function GruppeDetailPage(
  props: PageProps<"/gruppen/[gruppeId]">,
) {
  const { gruppeId } = await props.params;
  const t = await getTranslations("groupDetail");
  const user = (await getUser())!;

  const data = await fetchGroupData(gruppeId);
  if (!data) notFound();
  const myMembership = data.members.find((m) => m.profile_id === user.id);
  if (!myMembership) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/gruppen"
          className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon size={14} />
          {t("backToGroups")}
        </Link>
      </div>

      <Suspense fallback={<GroupDetailSkeleton />}>
        <GruppeDetailContent data={data} myMembership={myMembership} />
      </Suspense>
    </main>
  );
}

async function fetchGroupData(slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(groupTag(slug));

  const supabase = createAdminClient();

  // Errors must throw, never return null/empty: a thrown error is not stored
  // in the cache, a returned "not found" would be (for the cacheLife window).
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, slug, name, year, state, budget_hint, note")
    .eq("slug", slug)
    .maybeSingle();
  if (groupError) {
    throw new Error(
      `[fetchGroupData] group lookup failed: ${groupError.message}`,
    );
  }

  if (!group) return null;

  const { data: membersRaw, error: membersError } = await supabase
    .from("memberships")
    .select(
      "id, name_snapshot, first_name_snapshot, last_name_snapshot, role, profile_id",
    )
    .eq("group_id", (group as Group).id)
    .order("joined_at", { ascending: true })
    .order("id", { ascending: true });
  if (membersError) {
    throw new Error(
      `[fetchGroupData] members lookup failed: ${membersError.message}`,
    );
  }

  const members = (membersRaw ?? []) as Member[];

  const profileIds = members
    .map((m) => m.profile_id)
    .filter((id): id is string => !!id);

  const profilesById = new Map<string, ProfileRow>();
  if (profileIds.length > 0) {
    const { data: profilesRaw, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", profileIds);
    if (profilesError) {
      throw new Error(
        `[fetchGroupData] profiles lookup failed: ${profilesError.message}`,
      );
    }
    for (const p of (profilesRaw ?? []) as ProfileRow[]) {
      profilesById.set(p.id, p);
    }
  }

  const displayNames = abbreviateNames(
    membersFromMemberships(members, profilesById),
  ).map((d): [string, string] => [d.id, d.displayName]);

  return { group: group as Group, members, displayNames };
}

type GroupData = NonNullable<Awaited<ReturnType<typeof fetchGroupData>>>;

async function GruppeDetailContent({
  data,
  myMembership,
}: {
  data: GroupData;
  myMembership: Member;
}) {
  const t = await getTranslations("groupDetail");
  const { group: g, members, displayNames } = data;

  const isAdmin = myMembership.role === "admin";
  const displayNameById = new Map(displayNames);

  let inviteUrl: string | null = null;
  if (isAdmin && g.state === "open") {
    const token = await getOrCreateToken(g.id);
    inviteUrl = buildInviteUrl(await getSiteUrl(), token);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold break-words">{g.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{g.year}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <StateBadge
            state={g.state}
            t={{ open: t("stateOpen"), drawn: t("stateDrawn") }}
          />
          {isAdmin && (
            <Link
              href={`/gruppen/${g.slug}/einstellungen`}
              className="text-muted-foreground inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline"
            >
              {t("settings")}
            </Link>
          )}
          {inviteUrl && <CopyInviteLink inviteUrl={inviteUrl} />}
        </div>
      </div>

      {g.budget_hint && (
        <div className="border-border bg-muted/30 mb-4 rounded-lg border px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{t("budget")}:</span> {g.budget_hint}
          </p>
        </div>
      )}

      {g.note && (
        <div className="border-border bg-muted/30 mb-6 rounded-lg border px-4 py-3">
          <p className="text-sm whitespace-pre-line">
            <span className="font-medium">{t("note")}:</span> {g.note}
          </p>
        </div>
      )}

      <Suspense
        fallback={
          <LoadingRegion className="mb-6">
            <Skeleton className="h-10 w-full rounded-lg" />
          </LoadingRegion>
        }
      >
        <AssignmentSection
          groupId={g.id}
          slug={g.slug}
          state={g.state}
          isAdmin={isAdmin}
          myMembershipId={myMembership.id}
          memberCount={members.length}
          members={members}
        />
      </Suspense>

      <div className="mb-6 grid grid-cols-2 gap-3">
        {[
          { label: t("participants"), value: members.length },
          { label: "Jahr", value: g.year },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="border-border bg-card relative min-w-0 overflow-hidden rounded-lg border px-4 pt-5 pb-4"
          >
            <div className="bg-crimson absolute inset-x-0 top-0 h-[3px]" />
            <p className="text-muted-foreground truncate text-xs font-medium">
              {label}
            </p>
            <p className="mt-1 truncate text-xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("participants")} ({members.length})
        </h2>
        <ul className="space-y-2">
          {members.map((m) => {
            const parts = m.name_snapshot.trim().split(/\s+/);
            const memberInitials = (
              (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
            ).toUpperCase();
            const isMemberAdmin = m.role === "admin";
            const displayName = isAdmin
              ? m.name_snapshot
              : (displayNameById.get(m.id) ?? m.name_snapshot);
            return (
              <li
                key={m.id}
                className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={[
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      isMemberAdmin
                        ? "border-crimson bg-crimson/10 text-crimson"
                        : "border-border bg-secondary text-navy",
                    ].join(" ")}
                  >
                    {memberInitials}
                  </div>
                  <span className="font-medium">{displayName}</span>
                </div>
                {isMemberAdmin && (
                  <span className="text-muted-foreground text-xs">
                    {t("adminBadge")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4">
          <LeaveGroupButton slug={g.slug} drawn={g.state === "drawn"} />
        </div>
      </section>
    </>
  );
}

async function AssignmentSection({
  groupId,
  slug,
  state,
  isAdmin,
  myMembershipId,
  memberCount,
  members,
}: {
  groupId: string;
  slug: string;
  state: GroupState;
  isAdmin: boolean;
  myMembershipId: string;
  memberCount: number;
  members: Member[];
}) {
  const t = await getTranslations("groupDetail");
  const draw = await getTranslations("draw");

  if (state === "open") {
    if (!isAdmin) {
      return (
        <p className="text-muted-foreground mb-6 text-sm">
          {t("waitingForDraw")}
        </p>
      );
    }

    const canDraw = memberCount >= 3;
    return (
      <section className="mb-6 space-y-2">
        {canDraw ? (
          <DrawButton slug={slug} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {draw("notEnoughMembersHint")}
          </p>
        )}
      </section>
    );
  }

  if (isAdmin) {
    return (
      <div className="mb-6 space-y-4">
        <MyAssignment
          groupId={groupId}
          myMembershipId={myMembershipId}
          label={t("youGiveTo")}
        />
        <AdminOracle slug={slug} members={members} />
        <RedrawButton slug={slug} />
      </div>
    );
  }

  return (
    <MyAssignment
      groupId={groupId}
      myMembershipId={myMembershipId}
      label={t("youGiveTo")}
      adminLookupNotice={t("adminLookupNotice")}
    />
  );
}

async function MyAssignment({
  groupId,
  myMembershipId,
  label,
  adminLookupNotice,
}: {
  groupId: string;
  myMembershipId: string;
  label: string;
  adminLookupNotice?: string;
}) {
  // Uses the user-scoped client so RLS restricts the row to the caller's own assignment.
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select("receiver_id")
    .eq("group_id", groupId)
    // Admin RLS can read every row in the group, so filter to the caller's own.
    .eq("giver_id", myMembershipId)
    .limit(1)
    .single();

  if (!assignment) return null;

  const receiverId = (assignment as { receiver_id: string }).receiver_id;

  const admin = createAdminClient();
  const { data: membersRaw } = await admin
    .from("memberships")
    .select(
      "id, name_snapshot, first_name_snapshot, last_name_snapshot, profile_id",
    )
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true })
    .order("id", { ascending: true });

  const memberships = (membersRaw ?? []) as {
    id: string;
    name_snapshot: string;
    first_name_snapshot: string | null;
    last_name_snapshot: string | null;
    profile_id: string | null;
  }[];

  const profileIds = memberships
    .map((m) => m.profile_id)
    .filter((id): id is string => !!id);

  const profilesById = new Map<string, ProfileRow>();
  if (profileIds.length > 0) {
    const { data: profilesRaw } = await admin
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", profileIds);
    for (const p of (profilesRaw ?? []) as ProfileRow[]) {
      profilesById.set(p.id, p);
    }
  }

  const displayByMembershipId = new Map(
    abbreviateNames(membersFromMemberships(memberships, profilesById)).map(
      (d) => [d.id, d.displayName],
    ),
  );

  const receiverDisplay = displayByMembershipId.get(receiverId);
  if (!receiverDisplay) return null;

  return (
    <section className="mb-6 space-y-2">
      <div className="border-border bg-card rounded-lg border px-4 py-4">
        <p className="text-sm">
          <span className="font-medium">{label}:</span>{" "}
          <span className="font-semibold">{receiverDisplay}</span>
        </p>
      </div>
      {adminLookupNotice && (
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <InfoIcon size={14} className="mt-0.5 shrink-0" />
          {adminLookupNotice}
        </p>
      )}
    </section>
  );
}
