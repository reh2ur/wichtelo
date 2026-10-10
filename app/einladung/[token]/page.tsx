import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getTranslations, getMessages } from "next-intl/server";
import { resolveToken, type ResolvedInvite } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";
import {
  InviteAuthForm,
  InviteAcceptForm,
  InviteProvider,
} from "./invite-form";
import { InviteSkeleton } from "./invite-skeleton";

// Blocking route: token check runs before streaming so invalid tokens get a
// real 404. The actual real-404 guarantee comes from proxy.ts, which
// rewrites invalid tokens to /einladung/ungueltig before any rendering
// starts — this check is defense in depth for direct hits that bypass that.
export const instant = false;

export default async function EinladungPage(
  props: PageProps<"/einladung/[token]">,
) {
  const { token } = await props.params;
  // Resolve before the Suspense boundary: notFound() here still sets a real 404.
  const resolved = await resolveToken(token);
  if (!resolved) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <Suspense fallback={<InviteSkeleton />}>
        <EinladungContent token={token} resolved={resolved} />
      </Suspense>
    </main>
  );
}

async function EinladungContent({
  token,
  resolved,
}: {
  token: string;
  resolved: ResolvedInvite;
}) {
  const t = await getTranslations("invite");
  const messages = await getMessages();

  const { group, adminName } = resolved;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoggedIn = !!user;
  let hasProfile = false;
  let accountName = "";

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("id", user.id)
      .single();
    hasProfile = !!profile;
    accountName = profile
      ? `${profile.first_name} ${profile.last_name}`.trim()
      : "";

    if (hasProfile && group.state !== "drawn") {
      const { data: membership } = await supabase
        .from("memberships")
        .select("id")
        .eq("group_id", group.id)
        .eq("profile_id", user.id)
        .single();
      if (membership) {
        redirect(`/gruppen/${group.slug}`);
      }
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {t("groupLabel")}
        </p>
        <h1 className="text-3xl font-bold">{group.name}</h1>
        <p className="text-muted-foreground">{t("tagline")}</p>
        <p className="text-muted-foreground text-sm">{t("explanation")}</p>
        {group.budget_hint && (
          <p className="text-muted-foreground text-sm">
            <span className="font-medium">{t("budgetHint")}:</span>{" "}
            {group.budget_hint}
          </p>
        )}
        {group.note && (
          <p className="text-muted-foreground text-sm whitespace-pre-line">
            <span className="font-medium">{t("noteLabel")}:</span> {group.note}
          </p>
        )}
      </div>

      {group.state === "drawn" ? (
        <div className="space-y-3">
          <h2 className="text-xl font-bold">{t("deadEnd.title")}</h2>
          <p className="text-muted-foreground">{t("deadEnd.message")}</p>
          {adminName && (
            <p className="text-muted-foreground text-sm">
              {t("deadEnd.contact", { adminName })}
            </p>
          )}
        </div>
      ) : (
        <InviteProvider messages={{ invite: messages.invite }}>
          {isLoggedIn ? (
            <InviteAcceptForm
              token={token}
              hasProfile={hasProfile}
              accountName={accountName}
              accountEmail={user?.email ?? ""}
            />
          ) : (
            <InviteAuthForm token={token} />
          )}
        </InviteProvider>
      )}
    </div>
  );
}
