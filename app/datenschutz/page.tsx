import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata = {
  title: "Datenschutz – Wichtelo",
};

export default async function DatenschutzPage() {
  const t = await getTranslations("datenschutz");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeftIcon size={14} aria-hidden="true" />
        Zurück
      </Link>

      <h1 className="mb-6 text-3xl font-extrabold tracking-tight">
        {t("title")}
      </h1>

      <div className="text-foreground max-w-none space-y-6 text-sm">
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("controller.heading")}</h2>
          <p className="text-muted-foreground">{t("controller.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("dataCollected.heading")}</h2>
          <p className="text-muted-foreground">{t("dataCollected.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("purpose.heading")}</h2>
          <p className="text-muted-foreground">{t("purpose.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("legalBasis.heading")}</h2>
          <p className="text-muted-foreground">{t("legalBasis.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("processors.heading")}</h2>
          <p className="text-muted-foreground">{t("processors.intro")}</p>
          <ul className="text-muted-foreground list-inside list-disc space-y-1 pl-2">
            <li>{t("processors.supabase")}</li>
            <li>{t("processors.resend")}</li>
            <li>{t("processors.vercel")}</li>
            <li>{t("processors.speedInsights")}</li>
            <li>{t("processors.sentry")}</li>
            <li>{t("processors.redis")}</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">
            {t("transferSafeguard.heading")}
          </h2>
          <p className="text-muted-foreground">{t("transferSafeguard.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("serverLogs.heading")}</h2>
          <p className="text-muted-foreground">{t("serverLogs.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("speedInsights.heading")}</h2>
          <p className="text-muted-foreground">{t("speedInsights.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("operatorAccess.heading")}</h2>
          <p className="text-muted-foreground">{t("operatorAccess.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("retentionActive.heading")}</h2>
          <p className="text-muted-foreground">{t("retentionActive.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">
            {t("retentionAfterDeletion.heading")}
          </h2>
          <p className="text-muted-foreground">
            {t("retentionAfterDeletion.body")}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("cookies.heading")}</h2>
          <p className="text-muted-foreground">{t("cookies.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("minors.heading")}</h2>
          <p className="text-muted-foreground">{t("minors.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("memberVisibility.heading")}</h2>
          <p className="text-muted-foreground">{t("memberVisibility.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("oracleAccess.heading")}</h2>
          <p className="text-muted-foreground">{t("oracleAccess.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("auditLog.heading")}</h2>
          <p className="text-muted-foreground">{t("auditLog.body")}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("rights.heading")}</h2>
          <p className="text-muted-foreground">{t("rights.intro")}</p>
          <ul className="text-muted-foreground list-inside list-disc space-y-1 pl-2">
            <li>{t("rights.access")}</li>
            <li>{t("rights.rectification")}</li>
            <li>{t("rights.erasure")}</li>
            <li>{t("rights.restriction")}</li>
            <li>{t("rights.portability")}</li>
            <li>{t("rights.objection")}</li>
            <li>{t("rights.complaint")}</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t("contact.heading")}</h2>
          <p className="text-muted-foreground">{t("contact.body")}</p>
        </section>
      </div>
    </main>
  );
}
