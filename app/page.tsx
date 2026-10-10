import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LockSimpleIcon } from "@phosphor-icons/react/ssr";
import { buttonVariants } from "@/components/ui/button";

async function DeletedNotice({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.deleted !== "1") return null;
  const t = await getTranslations("app");
  return (
    <p
      role="status"
      className="border-border bg-card w-full max-w-xl rounded-lg border px-4 py-3 text-sm"
    >
      {t("accountDeleted")}
    </p>
  );
}

export default async function Home(props: PageProps<"/">) {
  const t = await getTranslations("app");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-10 px-4 py-16 text-center sm:py-24">
      <Suspense>
        <DeletedNotice searchParams={props.searchParams} />
      </Suspense>

      <div className="flex flex-col items-center gap-5">
        <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
          {t("hero.title")}
        </h1>
        <p className="text-muted-foreground max-w-xl text-lg text-balance">
          {t("hero.subtitle")}
        </p>
        <div className="mt-2 flex flex-col items-center gap-2">
          <Link
            href="/anmelden"
            className={buttonVariants({
              size: "lg",
              className: "px-8 text-base",
            })}
          >
            {t("hero.cta")}
          </Link>
          <span className="text-muted-foreground text-xs">
            {t("hero.ctaHint")}
          </span>
        </div>
      </div>

      <div className="border-border bg-card flex items-center gap-3 rounded-full border px-5 py-2.5 text-left shadow-sm">
        <span className="bg-crimson/15 text-crimson grid size-7 shrink-0 place-items-center rounded-full">
          <LockSimpleIcon
            aria-hidden="true"
            className="size-3.5"
            weight="bold"
          />
        </span>
        <p className="text-sm">
          <span className="font-semibold">{t("inviteOnly.title")}.</span>{" "}
          <span className="text-muted-foreground">
            {t("inviteOnly.description")}
          </span>
        </p>
      </div>
    </main>
  );
}
