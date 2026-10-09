import { Suspense } from "react";
import { getTranslations, getMessages } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import {
  GroupSettingsProvider,
  UpdateGroupInfoForm,
  ExclusionsSection,
  InviteLinkSection,
  ParticipantsSection,
  DangerSection,
  type Member,
  type Exclusion,
} from "./settings-forms";
import { SettingsSkeleton } from "./settings-skeleton";

export default function EinstellungenPage(
  props: PageProps<"/gruppen/[gruppeId]/einstellungen">,
) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <Suspense fallback={<SettingsSkeleton />}>
        <EinstellungenContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function EinstellungenContent({
  params,
}: {
  params: Promise<{ gruppeId: string }>;
}) {
  const { gruppeId } = await params;
  const t = await getTranslations("groupSettings");
  const messages = await getMessages();
  const user = (await getUser())!;

  const admin = createAdminClient();

  const { data: group } = await admin
    .from("groups")
    .select("id, slug, name, state, budget_hint, note")
    .eq("slug", gruppeId)
    .single();

  if (!group) notFound();

  const { data: membershipsRaw } = await admin
    .from("memberships")
    .select("id, name_snapshot, role, profile_id")
    .eq("group_id", group.id)
    .order("joined_at", { ascending: true });

  const members = (membershipsRaw ?? []) as Member[];
  const myMembership = members.find((m) => m.profile_id === user.id);

  if (!myMembership || myMembership.role !== "admin") {
    redirect(`/gruppen/${gruppeId}`);
  }

  const { data: exclusionsRaw } = await admin
    .from("exclusions")
    .select("id, member_a, member_b")
    .eq("group_id", group.id);

  const memberMap = new Map(members.map((m) => [m.id, m.name_snapshot]));

  const exclusions: Exclusion[] = (
    (exclusionsRaw ?? []) as {
      id: string;
      member_a: string;
      member_b: string;
    }[]
  ).map((ex) => ({
    id: ex.id,
    memberA: ex.member_a,
    memberB: ex.member_b,
    memberAName: memberMap.get(ex.member_a) ?? "—",
    memberBName: memberMap.get(ex.member_b) ?? "—",
  }));

  const g = group as {
    id: string;
    slug: string;
    name: string;
    state: "open" | "drawn";
    budget_hint: string | null;
    note: string | null;
  };

  return (
    <>
      <div className="mb-6">
        <Link
          href={`/gruppen/${g.slug}`}
          className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon size={14} />
          {t("backToGroup")}
        </Link>
      </div>

      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      <GroupSettingsProvider
        messages={{ groupSettings: messages.groupSettings }}
      >
        <UpdateGroupInfoForm
          group={{
            slug: g.slug,
            name: g.name,
            budget_hint: g.budget_hint,
            note: g.note,
          }}
        />

        <ExclusionsSection
          slug={g.slug}
          members={members}
          exclusions={exclusions}
          groupState={g.state}
        />

        <ParticipantsSection
          slug={g.slug}
          members={members}
          groupState={g.state}
          currentMembershipId={myMembership.id}
        />

        <InviteLinkSection slug={g.slug} groupState={g.state} />

        <DangerSection slug={g.slug} />
      </GroupSettingsProvider>
    </>
  );
}
