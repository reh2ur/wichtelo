import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmailLinkConfirm } from "@/components/email-link-confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { parseTokenHash } from "@/lib/auth/email-link";
import { confirmInviteLink } from "./actions";

export const metadata = { robots: { index: false, follow: false } };

// Target of the emailed button for invite sign-ins (`emailRedirectTo`). GET
// only renders a confirm button, the token is consumed by the POST action.
export default function InviteMagicLinkPage(
  props: PageProps<"/einladung/[token]/magiclink">,
) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
        <MagicLinkContent
          params={props.params}
          searchParams={props.searchParams}
        />
      </Suspense>
    </main>
  );
}

async function MagicLinkContent({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("emailLink");
  const { token } = await params;
  const tokenHash = parseTokenHash((await searchParams).token_hash);
  // Old PKCE links (?code=...) and mangled links land here too.
  if (!tokenHash) redirect(`/einladung/${token}?error=link_invalid`);

  return (
    <EmailLinkConfirm
      title={t("inviteTitle")}
      message={t("inviteMessage")}
      submitLabel={t("inviteSubmit")}
      tokenHash={tokenHash}
      action={confirmInviteLink.bind(null, token)}
    />
  );
}
