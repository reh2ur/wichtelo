"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  resendDrawEmails,
  retriggerDraw,
  type ResendDrawEmailsState,
  type RetriggerDrawState,
} from "./actions";
import {
  clearEmailWarning,
  setEmailWarning,
  useStoredEmailWarning,
} from "./email-warning";
import { createIntlContext } from "@/lib/create-intl-context";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";

const { Provider: RedrawProvider, useT: useRedrawT } =
  createIntlContext("redraw");

export { RedrawProvider };

export function RedrawButtonClient({ slug }: { slug: string }) {
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
  >(
    async (prev, formData) => {
      const next = await resendDrawEmails(prev, formData);
      if (next.status === "success") {
        if (next.emailsFailed > 0) {
          setEmailWarning(slug, next.emailsFailed, next.emailsTotal);
        } else {
          clearEmailWarning(slug);
        }
      }
      return next;
    },
    { status: "idle" },
  );

  const stored = useStoredEmailWarning(slug);
  const warning =
    resendState.status === "success"
      ? resendState.emailsFailed > 0
        ? { failed: resendState.emailsFailed, total: resendState.emailsTotal }
        : null
      : state.status === "success" && state.emailsFailed > 0
        ? { failed: state.emailsFailed, total: state.emailsTotal }
        : stored;
  const resendDone =
    resendState.status === "success" && resendState.emailsFailed === 0;
  const resendError =
    resendState.status === "error"
      ? resendState.error === "rate_limited"
        ? t("resendErrors.rateLimited")
        : t("resendErrors.generic")
      : null;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

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
        {warning && (
          <p role="status" className="text-danger-text text-sm">
            {t("emailFailure", {
              failed: warning.failed,
              total: warning.total,
            })}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => clearEmailWarning(slug)}
            >
              {t("dismissWarning")}
            </button>
          </p>
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
          onClick={() => {
            clearEmailWarning(slug);
            setConfirming(true);
          }}
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
