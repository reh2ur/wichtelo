import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CaretRightIcon, GiftIcon, PlusIcon } from "@phosphor-icons/react/ssr";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  abbreviateNames,
  membersFromMemberships,
} from "@/lib/name-abbreviator";
import { getUser } from "@/lib/auth/get-user";
import { buttonVariants } from "@/components/ui/button";
import { GroupListSkeleton } from "./group-list-skeleton";

type GroupState = "open" | "drawn";

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  year: number;
  state: GroupState;
}

interface MembershipWithGroup {
  id: string;
  role: "participant" | "admin";
  group_id: string;
  groups: GroupRow;
}

interface AssignmentRow {
  group_id: string;
  receiver_id: string;
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

export default async function GruppenPage() {
  const t = await getTranslations("groups");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link href="/gruppen/neu" className={buttonVariants({ size: "sm" })}>
          <PlusIcon aria-hidden="true" />
          {t("createNew")}
        </Link>
      </div>

      <Suspense fallback={<GroupListSkeleton />}>
        <GruppenPageContent />
      </Suspense>
    </main>
  );
}

async function GruppenPageContent() {
  const t = await getTranslations("groups");
  const user = (await getUser())!;
  const supabase = await createClient();
  const currentYear = new Date().getFullYear();

  const { data: raw } = await supabase
    .from("memberships")
    .select("id, role, group_id, groups!inner(id, slug, name, year, state)")
    .eq("profile_id", user.id);

  const memberships = (raw ?? []) as unknown as MembershipWithGroup[];

  const active = memberships.filter((m) => m.groups.year === currentYear);
  const past = memberships.filter((m) => m.groups.year < currentYear);

  const pastDrawnIds = past
    .filter((m) => m.groups.state === "drawn")
    .map((m) => m.id);

  const receiversByGroup: Record<string, string> = {};
  if (pastDrawnIds.length > 0) {
    // RLS lets participants read only their own assignment/membership rows,
    // so receiver display names are resolved server-side and abbreviated like
    // everywhere else (issue #179).
    const { data: assignments } = await supabase
      .from("assignments")
      .select("group_id, receiver_id")
      .in("giver_id", pastDrawnIds);

    const rows = (assignments as unknown as AssignmentRow[]) ?? [];
    if (rows.length > 0) {
      const admin = createAdminClient();
      const { data: membersRaw } = await admin
        .from("memberships")
        .select("id, group_id, name_snapshot, profile_id")
        .in(
          "group_id",
          rows.map((a) => a.group_id),
        );
      const members = (membersRaw ?? []) as {
        id: string;
        group_id: string;
        name_snapshot: string;
        profile_id: string | null;
      }[];
      const profileIds = members
        .map((m) => m.profile_id)
        .filter((id): id is string => !!id);
      const profilesById = new Map<
        string,
        { first_name: string; last_name: string }
      >();
      if (profileIds.length > 0) {
        const { data: profilesRaw } = await admin
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", profileIds);
        for (const p of profilesRaw ?? []) profilesById.set(p.id, p);
      }
      for (const a of rows) {
        const groupMembers = members.filter((m) => m.group_id === a.group_id);
        const display = abbreviateNames(
          membersFromMemberships(groupMembers, profilesById),
        ).find((d) => d.id === a.receiver_id);
        if (display) receiversByGroup[a.group_id] = display.displayName;
      }
    }
  }

  const stateBadgeTitles = { open: t("stateOpen"), drawn: t("stateDrawn") };
  const hasAnyGroups = memberships.length > 0;

  return (
    <>
      {!hasAnyGroups && (
        <section className="border-border bg-card rounded-xl border border-dashed px-6 py-10 text-center shadow-sm">
          <span className="bg-crimson/15 text-crimson mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full">
            <GiftIcon aria-hidden="true" className="size-5" weight="duotone" />
          </span>
          <p className="text-muted-foreground">{t("noGroups")}</p>
        </section>
      )}

      {hasAnyGroups && (
        <>
          <section className="mb-8">
            <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
              {t("activeTitle")}
            </h2>
            {active.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("noActiveGroups")}
              </p>
            ) : (
              <ul className="space-y-2">
                {active.map((m) => (
                  <li key={m.group_id}>
                    <Link
                      href={`/gruppen/${m.groups.slug}`}
                      className="border-border bg-card hover:bg-muted/50 flex items-center justify-between rounded-lg border px-4 py-3 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{m.groups.name}</span>
                        {m.role === "admin" && (
                          <span className="text-muted-foreground text-xs">
                            {t("adminBadge")}
                          </span>
                        )}
                      </div>
                      <StateBadge state={m.groups.state} t={stateBadgeTitles} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground mb-3 cursor-pointer list-none text-sm font-semibold tracking-wide uppercase">
                <CaretRightIcon
                  size={12}
                  className="mr-1 inline-block transition-transform group-open:rotate-90"
                />
                {t("pastTitle")}
              </summary>
              <ul className="mt-3 space-y-2">
                {past.map((m) => (
                  <li key={m.group_id}>
                    <Link
                      href={`/gruppen/${m.groups.slug}`}
                      className="border-border bg-card hover:bg-muted/50 flex items-center justify-between rounded-lg border px-4 py-3 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.groups.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {m.groups.year}
                          </span>
                        </div>
                        {receiversByGroup[m.group_id] && (
                          <p className="text-muted-foreground text-sm">
                            {t("gaveTo", {
                              name: receiversByGroup[m.group_id],
                            })}
                          </p>
                        )}
                      </div>
                      <StateBadge state={m.groups.state} t={stateBadgeTitles} />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
