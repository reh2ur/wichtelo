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
      <Menu.Trigger
        aria-label={t("menu")}
        className="text-navy flex items-center gap-2 text-xs outline-none"
      >
        {firstName && <span>{firstName}</span>}
        <div className="bg-primary text-primary-foreground flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-xs font-extrabold">
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
              className="data-[highlighted]:bg-muted flex items-center gap-2 rounded-md px-2.5 py-1.5 outline-none"
            >
              <UserIcon className="size-4" />
              {t("account")}
            </Menu.Item>
            <Menu.Item
              onClick={async () => {
                await signOut();
              }}
              className="data-[highlighted]:bg-muted flex items-center gap-2 rounded-md px-2.5 py-1.5 outline-none"
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
