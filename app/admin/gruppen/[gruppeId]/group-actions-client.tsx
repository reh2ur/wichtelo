"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  reopenGroup,
  deleteGroup,
  type ReopenGroupState,
  type DeleteGroupState,
} from "../actions";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: GroupActionsProvider, useT: useGroupActionsT } =
  createIntlContext("adminGroups");

export { GroupActionsProvider };

function errorMessage(
  t: ReturnType<typeof useGroupActionsT>,
  error: "not_admin" | "group_not_found" | "generic" | undefined,
): string | null {
  if (!error) return null;
  if (error === "not_admin") return t("errors.notAdmin");
  if (error === "group_not_found") return t("errors.groupNotFound");
  return t("errors.generic");
}

function ReopenGroupButton({ groupId }: { groupId: string }) {
  const t = useGroupActionsT();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ReopenGroupState, FormData>(
    reopenGroup,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, router]);

  const errorMsg =
    state.status === "error" ? errorMessage(t, state.error) : null;

  if (!confirming || state.status === "success") {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setConfirming(true)}
      >
        {t("actions.reopen")}
      </Button>
    );
  }

  return (
    <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{t("actions.reopenConfirmTitle")}</p>
      <p className="text-muted-foreground text-sm">
        {t("actions.reopenConfirmMessage")}
      </p>
      {errorMsg && <p className="text-danger-text text-sm">{errorMsg}</p>}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="groupId" value={groupId} />
        <Button type="submit" disabled={pending}>
          {pending ? t("actions.reopening") : t("actions.confirm")}
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

function DeleteGroupButton({ groupId }: { groupId: string }) {
  const t = useGroupActionsT();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<DeleteGroupState, FormData>(
    deleteGroup,
    { status: "idle" },
  );

  const errorMsg =
    state.status === "error" ? errorMessage(t, state.error) : null;

  if (!confirming) {
    return (
      <Button
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
      <p className="text-sm font-medium">{t("actions.deleteConfirmTitle")}</p>
      <p className="text-muted-foreground text-sm">
        {t("actions.deleteConfirmMessage")}
      </p>
      {errorMsg && <p className="text-danger-text text-sm">{errorMsg}</p>}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="groupId" value={groupId} />
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

export function GroupActionsClient({
  groupId,
  state,
}: {
  groupId: string;
  state: "open" | "drawn";
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      {state === "drawn" && <ReopenGroupButton groupId={groupId} />}
      <DeleteGroupButton groupId={groupId} />
    </div>
  );
}
