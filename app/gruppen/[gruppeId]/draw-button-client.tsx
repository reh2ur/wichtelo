"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { triggerDraw, type DrawState } from "./actions";
import { setEmailWarning } from "./email-warning";
import { createIntlContext } from "@/lib/create-intl-context";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";

const { Provider: DrawProvider, useT: useDrawT } = createIntlContext("draw");

export { DrawProvider };

function errorMessage(
  state: DrawState,
  t: ReturnType<typeof useDrawT>,
): string | null {
  if (state.status !== "error") return null;
  switch (state.error) {
    case "not_admin":
      return t("errors.notAdmin");
    case "group_not_found":
      return t("errors.groupNotFound");
    case "already_drawn":
      return t("errors.alreadyDrawn");
    case "not_enough_members":
      return t("errors.notEnoughMembers");
    case "unsolvable":
      return t("errors.unsolvable");
    case "too_complex":
      return t("errors.tooComplex");
    case "ghost_members":
      return t("errors.ghostMembers");
    case "rate_limited":
      return t("errors.rateLimited");
    default:
      return t("errors.generic");
  }
}

export function DrawButtonClient({ slug }: { slug: string }) {
  const t = useDrawT();
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, titleRef } = useConfirmFocus(confirming);
  const [state, action, pending] = useActionState<DrawState, FormData>(
    async (prev, formData) => {
      const next = await triggerDraw(prev, formData);
      // Button unmounts once the group is drawn; hand warning to the page.
      if (next.status === "success" && next.emailsFailed > 0) {
        setEmailWarning(slug, next.emailsFailed, next.emailsTotal);
      }
      return next;
    },
    { status: "idle" },
  );
  const error = errorMessage(state, t);
  const emailWarning =
    state.status === "success" && state.emailsFailed > 0
      ? t("emailFailure", {
          failed: state.emailsFailed,
          total: state.emailsTotal,
        })
      : null;

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button
          ref={triggerRef}
          type="button"
          onClick={() => setConfirming(true)}
        >
          {t("start")}
        </Button>
        {emailWarning && (
          <p role="status" className="text-danger-text text-sm">
            {emailWarning}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("confirm.title")}
      </p>
      <p className="text-muted-foreground text-sm">{t("confirm.message")}</p>
      {error && (
        <p role="alert" className="text-danger-text text-sm">
          {error}
        </p>
      )}
      {emailWarning && (
        <p role="status" className="text-danger-text text-sm">
          {emailWarning}
        </p>
      )}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" disabled={pending}>
          {pending ? t("starting") : t("confirm.button")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {t("confirm.cancel")}
        </Button>
      </form>
    </div>
  );
}
