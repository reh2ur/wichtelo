"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { SignOutIcon, UserIcon } from "@phosphor-icons/react/ssr";
import { signOut } from "@/lib/auth/sign-out";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: NavUserMenuProvider, useT: useNavT } =
  createIntlContext("nav");

export { NavUserMenuProvider };

export function NavUserMenuClient({
  firstName,
  avatarInitials,
}: {
  firstName: string;
  avatarInitials: string;
}) {
  const t = useNavT();

  return (
    <Menu.Root>
      <Menu.Trigger className="text-navy focus-visible:ring-crimson flex min-h-11 items-center gap-2 rounded-full text-xs outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
        {firstName && <span>{firstName}</span>}
        <span className="sr-only">{t("menu")}</span>
        <div
          aria-hidden="true"
          className="bg-primary text-primary-foreground flex h-11 w-11 items-center justify-center rounded-full border-2 border-white text-xs font-extrabold md:h-9 md:w-9"
        >
          {avatarInitials || "?"}
        </div>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-50"
        >
          <Menu.Popup className="border-border bg-background text-foreground min-w-[160px] rounded-lg border p-1 text-sm shadow-lg">
            <Menu.Item
              render={<Link href="/konto" />}
              className="data-[highlighted]:bg-muted flex min-h-11 items-center gap-2 rounded-md px-2.5 py-1.5 outline-none md:min-h-8"
            >
              <UserIcon className="size-4" />
              {t("account")}
            </Menu.Item>
            <Menu.Item
              onClick={async () => {
                await signOut();
              }}
              className="data-[highlighted]:bg-muted flex min-h-11 items-center gap-2 rounded-md px-2.5 py-1.5 outline-none md:min-h-8"
            >
              <SignOutIcon className="size-4" />
              {t("logout")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
