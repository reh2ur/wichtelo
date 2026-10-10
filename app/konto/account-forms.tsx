"use client";

import { useActionState } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  updateProfile,
  requestAccountDeletion,
  type UpdateProfileState,
  type RequestDeletionState,
} from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";
import { CONFIRM_TITLE_CLASS, useConfirmFocus } from "@/lib/use-confirm-focus";

const { Provider: AccountProvider, useT: useAccountT } =
  createIntlContext("account");

export { AccountProvider };

const INPUT_CLASS =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function UpdateProfileForm({
  firstName,
  lastName,
  email,
}: {
  firstName: string;
  lastName: string;
  email: string;
}) {
  const t = useAccountT();
  const [state, action, pending] = useActionState<UpdateProfileState, FormData>(
    updateProfile,
    { status: "idle" },
  );

  const errorMsg =
    state.status === "error"
      ? state.error === "missing_name"
        ? t("errors.missingName")
        : state.error === "too_long"
          ? t("errors.tooLong", { max: 50 })
          : t("errors.generic")
      : null;
  const v = state.status === "error" ? state.values : undefined;

  return (
    <section className="mb-8">
      <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
        {t("profile.section")}
      </h2>
      <form action={action} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="firstName" className="text-sm font-bold">
            {t("profile.firstNameLabel")}
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            defaultValue={v?.firstName ?? firstName}
            maxLength={50}
            required
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lastName" className="text-sm font-bold">
            {t("profile.lastNameLabel")}
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            defaultValue={v?.lastName ?? lastName}
            maxLength={50}
            required
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="email-display" className="text-sm font-bold">
            {t("profile.emailLabel")}
          </label>
          <input
            id="email-display"
            type="text"
            value={email}
            disabled
            className={INPUT_CLASS}
            aria-describedby="email-note"
          />
          <p id="email-note" className="text-muted-foreground text-xs">
            {t("profile.emailNote")}
          </p>
        </div>
        {errorMsg && (
          <p role="alert" className="text-danger-text text-sm">
            {errorMsg}
          </p>
        )}
        {state.status === "success" && (
          <p className="text-success-text text-sm">
            {t("profile.saveSuccess")}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? t("profile.saving") : t("profile.save")}
        </Button>
      </form>
    </section>
  );
}

export function DeleteAccountSection() {
  const t = useAccountT();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<
    RequestDeletionState,
    FormData
  >(requestAccountDeletion, { status: "idle" });
  const { triggerRef, titleRef } = useConfirmFocus(confirming);

  if (state.status === "sent") {
    return (
      <section className="mb-8">
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("danger.section")}
        </h2>
        <div className="border-border bg-card rounded-lg border p-4">
          <p className="font-medium">{t("danger.sentTitle")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("danger.sentMessage")}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
        {t("danger.section")}
      </h2>
      {!confirming ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          {t("danger.delete")}
        </Button>
      ) : (
        <div className="border-destructive/30 bg-destructive/5 space-y-3 rounded-lg border p-4">
          <p ref={titleRef} tabIndex={-1} className={CONFIRM_TITLE_CLASS}>
            {t("danger.confirmTitle")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("danger.confirmMessage")}
          </p>
          {state.status === "error" && (
            <p role="alert" className="text-danger-text text-sm">
              {state.error === "rate_limited"
                ? t("errors.rateLimited")
                : state.error === "email_failed"
                  ? t("errors.emailFailed")
                  : state.error === "sole_admin"
                    ? t("errors.soleAdmin", { groups: state.groups.join(", ") })
                    : t("errors.generic")}
            </p>
          )}
          <form action={action} className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? t("danger.deleting") : t("danger.confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              {t("danger.cancel")}
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
