import Image from "next/image";
import Link from "next/link";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NavUserMenuProvider,
  NavUserMenuClient,
} from "@/components/nav-user-menu-client";

function SignInLink() {
  return (
    <Link
      href="/anmelden"
      className="focus-visible:outline-crimson text-navy hover:bg-navy/10 rounded-md px-2 py-1 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Anmelden
    </Link>
  );
}

function UserMenuPlaceholder() {
  return (
    <span aria-hidden="true" className="flex items-center gap-2">
      <Skeleton className="h-4 w-14 rounded" />
      <Skeleton className="h-9 w-9 rounded-full" />
    </span>
  );
}

async function NavAccountControl() {
  const user = await getUser();

  let firstName = "";
  let avatarInitials = "";

  if (user) {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .single();

    if (profile) {
      const p = profile as { first_name: string; last_name: string };
      firstName = p.first_name;
      avatarInitials = (
        (p.first_name[0] ?? "") + (p.last_name[0] ?? "")
      ).toUpperCase();
    }
  }

  const messages = user ? await getMessages() : null;

  if (user && messages) {
    return (
      <NavUserMenuProvider messages={{ nav: messages.nav }}>
        <NavUserMenuClient
          firstName={firstName}
          avatarInitials={avatarInitials}
        />
      </NavUserMenuProvider>
    );
  }

  return <SignInLink />;
}

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/60 bg-white/50 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="focus-visible:ring-crimson rounded-md transition-opacity outline-none hover:opacity-90 focus-visible:ring-2"
        >
          <Image
            src="/brand/wichtelo-logo.png"
            alt="Wichtelo"
            width={800}
            height={391}
            priority
            className="h-11 w-auto"
          />
        </Link>
        <Suspense fallback={<UserMenuPlaceholder />}>
          <NavAccountControl />
        </Suspense>
      </div>
    </header>
  );
}
