import type { Metadata } from "next";
import { Manrope, Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";
import { cn } from "@/lib/utils";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Nav } from "@/components/nav";
import { Snow } from "@/components/snow";
import { Footer } from "@/components/footer";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wichtelo",
  description: "Organisiere deine Wichtelrunde",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      className={cn(
        "h-full",
        "antialiased",
        manrope.variable,
        "font-sans",
        geist.variable,
      )}
    >
      <body className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] font-(family-name:--font-manrope) font-semibold">
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
