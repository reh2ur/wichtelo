"use client";

import Link from "next/link";
import { buttonVariants, Button } from "@/components/ui/button";
import messages from "@/messages/de.json";

const t = messages.errorPage;

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="text-muted-foreground mt-3">{t.message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={() => reset()}>{t.retry}</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t.home}
        </Link>
      </div>
    </main>
  );
}
