import { getTranslations } from "next-intl/server";
import { AuthForm } from "./auth-form";

export const metadata = {
  title: "Anmelden – Wichtelo",
};

export default async function AnmeldenPage() {
  const t = await getTranslations("signIn");

  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm px-4">
        <div className="border-border bg-card space-y-6 rounded-lg border p-6 shadow-sm">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <AuthForm />
        </div>
      </div>
    </main>
  );
}
