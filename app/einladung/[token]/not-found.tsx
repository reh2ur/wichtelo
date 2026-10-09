import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("invite");
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground mt-3">{t("notFoundMessage")}</p>
    </main>
  );
}
