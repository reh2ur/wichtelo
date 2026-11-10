import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { StateBadge } from "@/components/state-badge";
import Link from "next/link";
import { CaretRightIcon, GiftIcon, PlusIcon } from "@phosphor-icons/react/ssr";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadMembershipsWithGroups,
  loadReceiverNamesByGroup,
  type MembershipWithGroup,
} from "@/lib/group-reads";
import { requireUser } from "@/lib/auth/require-auth";
import { buttonVariants } from "@/components/ui/button";
import { GroupListSkeleton } from "./group-list-skeleton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("groups");
  return { title: t("title") };
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
  const user = await requireUser();
  const supabase = await createClient();
  const currentYear = new Date().getFullYear();

  const memberships = await loadMembershipsWithGroups(supabase, user.id);

  // Open groups stay active whatever their year (e.g. created with last
  // year's year); future-year groups are active too.
  const isActive = (m: MembershipWithGroup) =>
    m.groups.year >= currentYear || m.groups.state === "open";
  const active = memberships.filter(isActive);
  const past = memberships.filter((m) => !isActive(m));

  const pastDrawnIds = past
    .filter((m) => m.groups.state === "drawn")
    .map((m) => m.id);

  const receiversByGroup = await loadReceiverNamesByGroup(
    supabase,
    createAdminClient(),
    pastDrawnIds,
  );

  const stateBadgeTitles = { open: t("stateOpen"), drawn: t("stateDrawn") };
  const hasAnyGroups = memberships.length > 0;

  return (
    <>
      {!hasAnyGroups && (
        <section className="border-border bg-card rounded-xl border border-dashed px-6 py-10 text-center shadow-sm">
          <span className="bg-crimson/15 text-danger-text mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full">
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
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="min-w-0 font-medium break-words">
                          {m.groups.name}
                        </span>
                        {m.role === "admin" && (
                          <span className="text-muted-foreground text-xs">
                            {t("adminBadge")}
                          </span>
                        )}
                      </div>
                      <StateBadge
                        state={m.groups.state}
                        labels={stateBadgeTitles}
                      />
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
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 font-medium break-words">
                            {m.groups.name}
                          </span>
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
                      <StateBadge
                        state={m.groups.state}
                        labels={stateBadgeTitles}
                      />
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
