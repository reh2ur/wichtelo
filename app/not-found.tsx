import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errorPage");
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground mt-3">{t("notFoundMessage")}</p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        {t("home")}
      </Link>
    </main>
  );
}
