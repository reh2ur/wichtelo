import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import "./globals.css";
import { cn } from "@/lib/utils";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Nav } from "@/components/nav";
import { Snow } from "@/components/snow";
import { Footer } from "@/components/footer";

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s – ${t("name")}` },
    description: t("description"),
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      className={cn("h-full", "antialiased", manrope.variable, "font-sans")}
    >
      <body className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] font-sans font-semibold">
        <NextIntlClientProvider locale="de" messages={null}>
          <Snow />
          <Nav />
          <div className="relative z-[1] grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            {children}
            <Footer />
          </div>
        </NextIntlClientProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
