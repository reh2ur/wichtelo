"use client";

import { Input } from "@/components/ui/input";
import { useActionState } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FocusStatus } from "@/components/focus-status";
import { FormError, errorFieldProps } from "@/components/form-error";
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
          <Input
            id="firstName"
            name="firstName"
            type="text"
            defaultValue={v?.firstName ?? firstName}
            maxLength={50}
            required
            {...errorFieldProps("profile-error", errorMsg !== null)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="lastName" className="text-sm font-bold">
            {t("profile.lastNameLabel")}
          </label>
          <Input
            id="lastName"
            name="lastName"
            type="text"
            defaultValue={v?.lastName ?? lastName}
            maxLength={50}
            required
            {...errorFieldProps("profile-error", errorMsg !== null)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="email-display" className="text-sm font-bold">
            {t("profile.emailLabel")}
          </label>
          <Input
            id="email-display"
            type="email"
            value={email}
            readOnly
            aria-describedby="email-note"
          />
          <p id="email-note" className="text-muted-foreground text-xs">
            {t("profile.emailNote")}
          </p>
        </div>
        <FormError id="profile-error">{errorMsg}</FormError>
        {state.status === "success" && (
          <p role="status" className="text-success-text text-sm">
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
        <FocusStatus className="border-border bg-card rounded-lg border p-4">
          <p className="font-medium">{t("danger.sentTitle")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("danger.sentMessage")}
          </p>
        </FocusStatus>
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
            <FormError>
              {state.error === "rate_limited"
                ? t("errors.rateLimited")
                : state.error === "email_failed"
                  ? t("errors.emailFailed")
                  : state.error === "sole_admin"
                    ? t("errors.soleAdmin", { groups: state.groups.join(", ") })
                    : t("errors.generic")}
            </FormError>
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
