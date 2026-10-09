import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";

export async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="relative z-[1] mt-6 h-24 w-full overflow-hidden sm:h-32">
      <Image
        aria-hidden="true"
        src="/brand/footer-landscape.svg"
        alt=""
        fill
        priority
        className="object-cover object-bottom"
      />
      <nav className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 text-xs font-medium text-gray-600">
        <Link
          href="/impressum"
          className="flex min-h-11 items-center px-3 underline-offset-4 hover:underline"
        >
          {t("impressum")}
        </Link>
        <Link
          href="/datenschutz"
          className="flex min-h-11 items-center px-3 underline-offset-4 hover:underline"
        >
          {t("datenschutz")}
        </Link>
      </nav>
    </footer>
  );
}
