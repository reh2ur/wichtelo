import type { Metadata } from "next";
import { getTranslations, getMessages } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/require-auth";
import { loadDistribution } from "@/lib/draw/distribution";
import { findCallerMembership } from "@/lib/group-access";
import {
  DistributionClient,
  DistributionProvider,
} from "./distribution-client";

// Blocking route like the settings page: group + admin checks run before
// streaming. The real-404 guarantee comes from proxy.ts (admin-only rewrite);
// this is defense in depth.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("distribution");
  return { title: t("title") };
}

export default async function VerteilungPage(
  props: PageProps<"/gruppen/[gruppeId]/verteilung">,
) {
  const { gruppeId } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("distribution");
  const admin = createAdminClient();

  // Errors throw (-> error.tsx); only a genuinely missing row is a 404.
  const { data: group, error: groupError } = await admin
    .from("groups")
    .select("id, slug, state, draw_version")
    .eq("slug", gruppeId)
    .maybeSingle();
  if (groupError) {
    throw new Error(`[verteilung] group lookup failed: ${groupError.message}`);
  }
  if (!group) notFound();

  const lookup = await findCallerMembership(admin, group.id, user.id);
  if (lookup.failed) throw new Error("[verteilung] membership lookup failed");
  const me = lookup.row;
  if (!me || me.role !== "admin") redirect(`/gruppen/${gruppeId}`);

  const header = (
    <div className="mb-6 space-y-2">
      <Link
        href={`/gruppen/${gruppeId}`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm underline"
      >
        <ArrowLeftIcon aria-hidden="true" size={14} />
        {t("backToGroup")}
      </Link>
      <h1 className="text-2xl font-extrabold">{t("title")}</h1>
    </div>
  );

  if (group.state !== "drawn") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        {header}
        <p className="text-muted-foreground text-sm">{t("notDrawn")}</p>
      </main>
    );
  }

  const view = await loadDistribution(admin, group, me);
  const messages = await getMessages();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      {header}
      <p className="text-muted-foreground mb-6 text-sm">{t("intro")}</p>
      <DistributionProvider messages={{ distribution: messages.distribution }}>
        <DistributionClient slug={gruppeId} view={view} />
      </DistributionProvider>
    </main>
  );
}
