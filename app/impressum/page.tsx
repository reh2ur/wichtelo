import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getOperator } from "@/lib/operator";

export const metadata = {
  title: "Impressum – Wichtelo",
};

export default async function ImpressumPage() {
  const t = await getTranslations("impressum");
  const operator = getOperator();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeftIcon size={14} aria-hidden="true" />
        Zurück
      </Link>

      <h1 className="mb-2 text-3xl font-extrabold tracking-tight">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mb-8 text-sm">{t("intro")}</p>

      <div className="text-foreground max-w-none space-y-6 text-sm">
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("operatorSection")}</h2>
          <address className="text-muted-foreground not-italic">
            {t("operatorName", { name: operator.name })}
            <br />
            {t("operatorAddress1", { line: operator.addressLine1 })}
            <br />
            {t("operatorAddress2", { line: operator.addressLine2 })}
            <br />
            {t("operatorCountry")}
          </address>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("contactSection")}</h2>
          <p className="text-muted-foreground">
            E-Mail:{" "}
            <a
              href={`mailto:${operator.contactEmail}`}
              className="hover:text-foreground underline"
            >
              {t("contactEmail", { email: operator.contactEmail })}
            </a>
          </p>
          <p className="text-muted-foreground">{t("contactResponseTime")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("responsibleSection")}</h2>
          <p className="text-muted-foreground">
            {t("responsibleName", { name: operator.name })}
          </p>
        </section>
      </div>
    </main>
  );
}
