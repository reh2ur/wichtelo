import { getTranslations } from "next-intl/server";

export async function LoadingRegion({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");
  return (
    <div className={className} aria-live="polite" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}
