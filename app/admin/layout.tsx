import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin/require-super-admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("admin");

  return (
    <>
      <nav className="border-border border-b">
        <div className="mx-auto flex w-full max-w-4xl gap-4 px-4 py-3 text-sm">
          <Link
            href="/admin"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("nav.overview")}
          </Link>
          <Link
            href="/admin/benutzer"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("nav.users")}
          </Link>
          <Link
            href="/admin/gruppen"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("nav.groups")}
          </Link>
          <Link
            href="/admin/audit-log"
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("nav.auditLog")}
          </Link>
        </div>
      </nav>
      <Suspense fallback={null}>
        <SuperAdminGuard>{children}</SuperAdminGuard>
      </Suspense>
    </>
  );
}

// Defense in depth: proxy.ts already 404s non-admins (with a real status), but
// its matcher skips paths ending in .png/.svg etc., so pages must not rely on
// it alone. Session read is dynamic, hence the Suspense boundary above.
async function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  if (!(await isSuperAdmin())) notFound();
  return <>{children}</>;
}
