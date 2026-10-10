import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { parseEmailLinkError } from "@/lib/auth/email-link";
import { AuthForm } from "./auth-form";

export const metadata = {
  title: "Anmelden – Wichtelo",
};

export default async function AnmeldenPage(props: PageProps<"/anmelden">) {
  const t = await getTranslations("signIn");

  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm px-4">
        <div className="border-border bg-card space-y-6 rounded-lg border p-6 shadow-sm">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <Suspense fallback={null}>
            <LinkError searchParams={props.searchParams} />
          </Suspense>
          <Suspense>
            <AuthForm searchParams={props.searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

// Set by the emailed-link confirm step (/auth/callback) when it fails.
async function LinkError({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const error = parseEmailLinkError((await searchParams).error);
  if (!error) return null;
  const t = await getTranslations("signIn");
  return (
    <p role="alert" className="text-destructive text-sm">
      {error === "rate_limited"
        ? t("errors.rateLimited")
        : t("errors.linkInvalid")}
    </p>
  );
}
