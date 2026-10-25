"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  dismissDrawMailWarning,
  resendDrawEmails,
  retriggerDraw,
  type DismissDrawMailWarningState,
  type ResendDrawEmailsState,
  type RetriggerDrawState,
} from "./actions";
import type { DrawMailWarning } from "@/lib/draw-mail-status";
import { createIntlContext } from "@/lib/create-intl-context";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";

const { Provider: RedrawProvider, useT: useRedrawT } =
  createIntlContext("redraw");

export { RedrawProvider };

export function RedrawButtonClient({
  slug,
  warning,
  needsRedraw,
}: {
  slug: string;
  /** Persisted failure of the current draw's mails (server-read, admin-only). */
  warning: DrawMailWarning | null;
  /** Live members lack an assignment (member removed after the draw, #141). */
  needsRedraw: boolean;
}) {
  const t = useRedrawT();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<RetriggerDrawState, FormData>(
    retriggerDraw,
    { status: "idle" },
  );
  const { triggerRef, titleRef } = useConfirmFocus(
    confirming && state.status !== "success",
  );

  const [resendState, resendAction, resending] = useActionState<
    ResendDrawEmailsState,
    FormData
  >(resendDrawEmails, { status: "idle" });
  const [dismissState, dismissAction, dismissing] = useActionState<
    DismissDrawMailWarningState,
    FormData
  >(dismissDrawMailWarning, { status: "idle" });

  // `warning` (server-read) is the single source of truth; every mutation
  // below refreshes the route to pick up the new value.
  const resendDone =
    resendState.status === "success" &&
    resendState.emailsFailed === 0 &&
    state.status !== "success";
  const resendError =
    resendState.status === "error"
      ? resendState.error === "rate_limited"
        ? t("resendErrors.rateLimited")
        : t("resendErrors.generic")
      : null;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (resendState.status === "success") router.refresh();
  }, [resendState, router]);

  useEffect(() => {
    if (dismissState.status === "success") router.refresh();
  }, [dismissState, router]);

  const errorMsg =
    state.status === "error"
      ? state.error === "unsolvable"
        ? t("errors.unsolvable")
        : state.error === "too_complex"
          ? t("errors.tooComplex")
          : state.error === "not_drawn"
            ? t("errors.notDrawn")
            : state.error === "not_admin"
              ? t("errors.notAdmin")
              : state.error === "group_not_found"
                ? t("errors.groupNotFound")
                : state.error === "rate_limited"
                  ? t("errors.rateLimited")
                  : state.error === "not_enough_members"
                    ? t("errors.notEnoughMembers")
                    : state.error === "membership_changed"
                      ? t("errors.membershipChanged")
                      : t("errors.generic")
      : null;

  if (!confirming || state.status === "success") {
    return (
      <div className="space-y-2">
        {needsRedraw && (
          <p
            role="status"
            data-testid="redraw-needed-banner"
            className="border-danger-text/30 bg-danger-text/5 text-danger-text rounded-lg border px-4 py-3 text-sm"
          >
            {t("needsRedraw")}
          </p>
        )}
        {warning && (
          <p role="status" className="text-danger-text text-sm">
            {t("emailFailure", {
              failed: warning.failed,
              total: warning.total,
            })}{" "}
          </p>
        )}
        {warning && (
          <form action={dismissAction}>
            <input type="hidden" name="slug" value={slug} />
            <button
              type="submit"
              className="text-danger-text text-sm underline"
              disabled={dismissing}
            >
              {t("dismissWarning")}
            </button>
          </form>
        )}
        {warning && (
          <form action={resendAction}>
            <input type="hidden" name="slug" value={slug} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={resending}
            >
              {resending ? t("resending") : t("resend")}
            </Button>
          </form>
        )}
        {resendError && (
          <p role="alert" className="text-danger-text text-sm">
            {resendError}
          </p>
        )}
        {resendDone && !warning && (
          <p role="status" className="text-sm">
            {t("resendDone")}
          </p>
        )}
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
        >
          {t("start")}
        </Button>
      </div>
    );
  }

  return (
    <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
      <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
        {t("confirm.title")}
      </p>
      <p className="text-muted-foreground text-sm">{t("confirm.message")}</p>
      {errorMsg && (
        <p role="alert" className="text-danger-text text-sm">
          {errorMsg}
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
