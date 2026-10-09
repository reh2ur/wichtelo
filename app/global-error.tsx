"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import "./globals.css";
import messages from "@/messages/de.json";

const t = messages.errorPage;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="de">
      <body className="bg-background text-foreground flex min-h-dvh items-center justify-center font-sans">
        <main className="mx-auto w-full max-w-lg px-4 py-16 text-center">
          <title>{t.title}</title>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground mt-3">{t.message}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
            >
              {t.retry}
            </button>

            <Link
              href="/"
              className="border-border rounded-lg border px-4 py-2 text-sm font-medium"
            >
              {t.home}
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
