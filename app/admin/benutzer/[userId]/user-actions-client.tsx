"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import {
  banUser,
  unbanUser,
  deleteUser,
  type BanUserState,
  type UnbanUserState,
  type DeleteUserState,
} from "../actions";
import { createIntlContext } from "@/lib/create-intl-context";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";

const { Provider: UserActionsProvider, useT: useUserActionsT } =
  createIntlContext("adminUsers");

export { UserActionsProvider };

function errorMessage(
  t: ReturnType<typeof useUserActionsT>,
  error:
    | "not_admin"
    | "user_not_found"
    | "sole_admin"
    | "self"
    | "generic"
    | undefined,
  groups?: string[],
): string | null {
  if (!error) return null;
  if (error === "sole_admin")
    return t("errors.soleAdmin", { groups: (groups ?? []).join(", ") });
  if (error === "not_admin") return t("errors.notAdmin");
  if (error === "user_not_found") return t("errors.userNotFound");
  if (error === "self") return t("errors.self");
  return t("errors.generic");
}

function BanUserButton({ userId }: { userId: string }) {
  const t = useUserActionsT();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<BanUserState, FormData>(
    banUser,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  const errorMsg =
    state.status === "error" ? errorMessage(t, state.error) : null;
  const open = confirming && state.status !== "success";
  const { triggerRef, titleRef } = useConfirmFocus(open);

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        {t("actions.ban")}
      </Button>
    );
  }

  return (
    <div className="border-destructive/30 bg-destructive/5 space-y-3 rounded-lg border p-4">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("actions.banConfirmTitle")}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("actions.banConfirmMessage")}
      </p>
      <FormError>{errorMsg}</FormError>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="userId" value={userId} />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t("actions.banning") : t("actions.confirm")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {t("actions.cancel")}
        </Button>
      </form>
    </div>
  );
}

function UnbanUserButton({ userId }: { userId: string }) {
  const t = useUserActionsT();
  const router = useRouter();
  const [state, action, pending] = useActionState<UnbanUserState, FormData>(
    unbanUser,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  const errorMsg =
    state.status === "error" ? errorMessage(t, state.error) : null;

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? t("actions.unbanning") : t("actions.unban")}
        </Button>
      </form>
      <FormError>{errorMsg}</FormError>
    </div>
  );
}

function DeleteUserButton({ userId }: { userId: string }) {
  const t = useUserActionsT();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<DeleteUserState, FormData>(
    deleteUser,
    { status: "idle" },
  );

  const errorMsg =
    state.status === "error"
      ? errorMessage(t, state.error, state.groups)
      : null;
  const { triggerRef, titleRef } = useConfirmFocus(confirming);

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        {t("actions.delete")}
      </Button>
    );
  }

  return (
    <div className="border-destructive/30 bg-destructive/5 space-y-3 rounded-lg border p-4">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("actions.deleteConfirmTitle")}
      </p>
      <p className="text-muted-foreground text-sm">
        {t("actions.deleteConfirmMessage")}
      </p>
      <FormError>{errorMsg}</FormError>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="userId" value={userId} />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t("actions.deleting") : t("actions.confirm")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {t("actions.cancel")}
        </Button>
      </form>
    </div>
  );
}

export function UserActionsClient({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      {banned ? (
        <UnbanUserButton userId={userId} />
      ) : (
        <BanUserButton userId={userId} />
      )}
      <DeleteUserButton userId={userId} />
    </div>
  );
}
