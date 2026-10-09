import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/ui/loading-region";
import { GroupForm } from "./group-form";

function GroupFormSkeleton() {
  return (
    <LoadingRegion className="space-y-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-10 w-32 rounded-lg" />
    </LoadingRegion>
  );
}

export default async function NeuePage() {
  const t = await getTranslations("createGroup");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/gruppen"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon size={14} aria-hidden="true" />
          Zurück
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>

      <Suspense fallback={<GroupFormSkeleton />}>
        <NeuePageContent />
      </Suspense>
    </main>
  );
}

async function NeuePageContent() {
  const user = (await getUser())!;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  const currentYear = new Date().getFullYear();

  return <GroupForm hasProfile={!!profile} currentYear={currentYear} />;
}
