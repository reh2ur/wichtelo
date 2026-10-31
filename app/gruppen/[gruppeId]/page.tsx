import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { StateBadge, type GroupState } from "@/components/state-badge";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon, InfoIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { getOrCreateToken } from "@/lib/invite";
import { loadMyReceiverId } from "@/lib/group-reads";
import { buildInviteUrl, getSiteUrl } from "@/lib/site-url";
import { buildDisplayNameMap } from "@/lib/member-display-names";
import { CopyInviteLink } from "./copy-invite-link";
import { DrawButton } from "./draw-button";
import { RedrawButton } from "./redraw-button";
import { AdminOracle } from "./admin-oracle";
import { LeaveGroupButton } from "./leave-button";
import { GroupDetailSkeleton } from "./group-detail-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";
import { RevealAssignment } from "./reveal-assignment";

type MemberRole = "participant" | "admin";

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

// Blocking route: existence + membership checks run before streaming so
// unknown groups and non-members get a real 404 status. The actual real-404
// guarantee comes from proxy.ts (lib/supabase/proxy.ts), which rewrites
// unknown slugs / non-members before any rendering starts — this check is
// defense in depth for direct hits that somehow bypass that.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("groupDetail");
  return { title: t("pageTitle") };
}

export default async function GruppeDetailPage(
  props: PageProps<"/gruppen/[gruppeId]">,
) {
  const { gruppeId } = await props.params;
  const t = await getTranslations("groupDetail");
  // Independent: session lookup and group read run concurrently.
  const [user, data] = await Promise.all([getUser(), fetchGroupData(gruppeId)]);
  if (!user) notFound();
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
  // Deliberately uncached: `updateTag` expiry is not guaranteed to reach every
  // instance with the per-process `use cache` handler (#95), so a warm
  // instance could serve a stale member list / draw button. Errors must throw,
  // never return null/empty, so a DB blip is an error page, not a fake 404.
  const supabase = createAdminClient();

  // One round trip: group + members + member profiles via PostgREST embeds.
  const { data: groupRaw, error: groupError } = await supabase
    .from("groups")
    .select(
      `id, slug, name, year, state, draw_version, budget_hint, note,
       memberships(id, name_snapshot, first_name_snapshot, last_name_snapshot, role, profile_id, profiles(id, first_name, last_name))`,
    )
    .eq("slug", slug)
    .order("joined_at", { referencedTable: "memberships", ascending: true })
    .order("id", { referencedTable: "memberships", ascending: true })
    .maybeSingle();
  if (groupError) {
    throw new Error(
      `[fetchGroupData] group lookup failed: ${groupError.message}`,
    );
  }

  if (!groupRaw) return null;

  const { memberships: membershipRows, ...group } = groupRaw;

  const members: Member[] = [];
  const profilesById = new Map<string, ProfileRow>();
  for (const { profiles, ...m } of membershipRows) {
    members.push(m);
    if (profiles) profilesById.set(profiles.id, profiles);
  }

  const displayNames = [...buildDisplayNameMap(members, profilesById)];

  return { group, members, displayNames };
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
            labels={{ open: t("stateOpen"), drawn: t("stateDrawn") }}
          />
          {isAdmin && (
            <Link
              href={`/gruppen/${g.slug}/einstellungen`}
              className="text-muted-foreground inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline"
            >
              {t("settings")}
            </Link>
          )}
          {isAdmin && g.state === "open" && (
            // Token lookup/creation streams in on its own; it no longer
            // blocks the rest of the page.
            <Suspense fallback={null}>
              <InviteLink groupId={g.id} />
            </Suspense>
          )}
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
          drawVersion={g.draw_version}
          isAdmin={isAdmin}
          myMembershipId={myMembership.id}
          memberCount={members.length}
          members={members}
          displayNames={displayNameById}
        />
      </Suspense>

      <div className="mb-6 grid grid-cols-2 gap-3">
        {[
          { label: t("participants"), value: members.length },
          { label: t("year"), value: g.year },
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
            const isMemberAdmin = m.role === "admin";
            const displayName = isAdmin
              ? m.name_snapshot
              : (displayNameById.get(m.id) ?? m.name_snapshot);
            // Initials come from what this viewer may see, so non-admins
            // never learn a last-name initial the display name omits.
            const parts = displayName.trim().split(/\s+/);
            const memberInitials = (
              (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
            ).toUpperCase();
            return (
              <li
                key={m.id}
                className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={[
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      isMemberAdmin
                        ? "border-crimson text-danger-text bg-white/70"
                        : "border-border bg-secondary text-navy",
                    ].join(" ")}
                  >
                    {memberInitials}
                  </div>
                  <span className="min-w-0 font-medium break-words">
                    {displayName}
                  </span>
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

async function InviteLink({ groupId }: { groupId: string }) {
  const token = await getOrCreateToken(groupId);
  return (
    <CopyInviteLink inviteUrl={buildInviteUrl(await getSiteUrl(), token)} />
  );
}

async function AssignmentSection({
  groupId,
  slug,
  state,
  drawVersion,
  isAdmin,
  myMembershipId,
  memberCount,
  members,
  displayNames,
}: {
  groupId: string;
  slug: string;
  state: GroupState;
  drawVersion: number;
  isAdmin: boolean;
  myMembershipId: string;
  memberCount: number;
  members: Member[];
  displayNames: Map<string, string>;
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
          displayNames={displayNames}
          label={t("youGiveTo")}
          redrawn={drawVersion > 1}
        />
        <AdminOracle slug={slug} members={members} />
        <RedrawButton slug={slug} groupId={groupId} />
      </div>
    );
  }

  return (
    <MyAssignment
      groupId={groupId}
      myMembershipId={myMembershipId}
      displayNames={displayNames}
      label={t("youGiveTo")}
      redrawn={drawVersion > 1}
      adminLookupNotice={t("adminLookupNotice")}
    />
  );
}

async function MyAssignment({
  groupId,
  myMembershipId,
  displayNames,
  label,
  redrawn,
  adminLookupNotice,
}: {
  groupId: string;
  myMembershipId: string;
  displayNames: Map<string, string>;
  label: string;
  redrawn: boolean;
  adminLookupNotice?: string;
}) {
  const t = await getTranslations("groupDetail");
  // Uses the user-scoped client so RLS restricts the row to the caller's own assignment.
  const receiverId = await loadMyReceiverId(
    await createClient(),
    groupId,
    myMembershipId,
  );

  // Drawn group but no outgoing row: an admin removed a member (their
  // assignments cascade) and has not re-drawn yet (#141).
  if (!receiverId) {
    return (
      <section className="mb-6" data-testid="assignment-orphaned">
        <div
          role="status"
          className="border-border bg-muted/30 flex items-start gap-2 rounded-lg border px-4 py-4"
        >
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          <p className="text-sm">{t("assignmentPending")}</p>
        </div>
      </section>
    );
  }

  const receiverDisplay = displayNames.get(receiverId);
  if (!receiverDisplay) return null;

  return (
    <section className="mb-6 space-y-2">
      <div className="border-border bg-card rounded-lg border px-4 py-4">
        <RevealAssignment
          label={label}
          name={receiverDisplay}
          revealLabel={t("revealAssignment")}
          hideLabel={t("hideAssignment")}
        />
        {redrawn && (
          <p
            className="text-muted-foreground mt-2 text-xs"
            data-testid="assignment-redrawn"
          >
            {t("redrawnNote")}
          </p>
        )}
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
