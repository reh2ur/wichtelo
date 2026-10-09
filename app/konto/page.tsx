import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations, getMessages } from "next-intl/server";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";
import {
  AccountProvider,
  UpdateProfileForm,
  DeleteAccountSection,
} from "./account-forms";

function AccountFormsSkeleton() {
  return (
    <LoadingRegion className="space-y-8">
      <div className="space-y-4">
        <Skeleton className="h-3.5 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
    </LoadingRegion>
  );
}

export default async function KontoPage() {
  const t = await getTranslations("account");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Link
          href="/gruppen"
          className="text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeftIcon size={16} />
          {t("backToGroups")}
        </Link>
      </div>
      <h1 className="mb-8 text-2xl font-bold">{t("title")}</h1>

      <Suspense fallback={<AccountFormsSkeleton />}>
        <KontoPageContent />
      </Suspense>
    </main>
  );
}

async function KontoPageContent() {
  const messages = await getMessages();
  const user = await getUser();
  if (!user) redirect("/anmelden");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .single();

  const firstName =
    (profile as { first_name: string; last_name: string } | null)?.first_name ??
    "";
  const lastName =
    (profile as { first_name: string; last_name: string } | null)?.last_name ??
    "";

  return (
    <AccountProvider messages={{ account: messages.account }}>
      <UpdateProfileForm
        firstName={firstName}
        lastName={lastName}
        email={user.email ?? ""}
      />
      <DeleteAccountSection />
    </AccountProvider>
  );
}
