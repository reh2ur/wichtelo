"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { leaveGroup, type LeaveGroupState } from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: LeaveGroupDetailProvider, useT: useLeaveGroupDetailT } =
  createIntlContext("groupDetail");

export { LeaveGroupDetailProvider };

export function LeaveGroupButtonClient({
  slug,
  drawn,
}: {
  slug: string;
  drawn: boolean;
}) {
  const t = useLeaveGroupDetailT();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<LeaveGroupState, FormData>(
    leaveGroup,
    { status: "idle" },
  );

  const errorMsg =
    state.status === "error"
      ? state.error === "last_admin"
        ? t("errors.lastAdmin")
        : state.error === "already_drawn"
          ? t("leave.drawnBlocked")
          : state.error === "rate_limited"
            ? t("errors.rateLimited")
            : t("errors.generic")
      : null;

  if (drawn) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid="leave-drawn-blocked"
      >
        {t("leave.drawnBlocked")}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setConfirming(true)}
      >
        {t("leave.button")}
      </Button>
    );
  }

  return (
    <div className="border-border bg-muted/30 mt-4 space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{t("leave.confirmTitle")}</p>
      <p className="text-muted-foreground text-sm">
        {t("leave.confirmMessage")}
      </p>
      {errorMsg && <p className="text-destructive text-sm">{errorMsg}</p>}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="slug" value={slug} />
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={pending}
        >
          {pending ? t("leave.leaving") : t("leave.confirm")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {t("leave.cancel")}
        </Button>
      </form>
    </div>
  );
}
