import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmailLinkConfirm } from "@/components/email-link-confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { parseTokenHash } from "@/lib/auth/email-link";
import { confirmSignInLink } from "./actions";

export const metadata = { robots: { index: false, follow: false } };

// Target of the emailed sign-in button (`emailRedirectTo`): the Auth mail
// templates link here with ?token_hash=...&type=email. GET only renders a
// confirm button, the token is consumed by the POST action (issue #24).
export default function AuthCallbackPage(props: PageProps<"/auth/callback">) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16">
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
        <CallbackContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function CallbackContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("emailLink");
  const tokenHash = parseTokenHash((await searchParams).token_hash);
  // Old PKCE links (?code=...) and mangled links land here too.
  if (!tokenHash) redirect("/anmelden?error=link_invalid");

  return (
    <EmailLinkConfirm
      title={t("signInTitle")}
      message={t("signInMessage")}
      submitLabel={t("signInSubmit")}
      tokenHash={tokenHash}
      action={confirmSignInLink}
    />
  );
}
