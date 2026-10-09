"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { OtpStep } from "@/components/otp-step";
import {
  requestInviteOtp,
  verifyInviteOtp,
  acceptInvite,
  type RequestInviteOtpState,
  type VerifyInviteOtpState,
  type AcceptInviteState,
} from "./actions";
import { signOutToInvite } from "@/lib/auth/sign-out";
import { createIntlContext } from "@/lib/create-intl-context";

const INPUT_CLASS =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const { Provider: InviteProvider, useT: useInviteT } =
  createIntlContext("invite");

export { InviteProvider };

export function InviteAuthForm({ token }: { token: string }) {
  const t = useInviteT();
  const requestAction = requestInviteOtp.bind(null, token);
  const verifyAction = verifyInviteOtp.bind(null, token);

  const [requestState, dispatchRequest, requestPending] = useActionState<
    RequestInviteOtpState,
    FormData
  >(requestAction, { status: "idle" });

  const [verifyState, dispatchVerify, verifyPending] = useActionState<
    VerifyInviteOtpState,
    FormData
  >(verifyAction, { status: "idle" });

  const [backedOutState, setBackedOutState] =
    useState<RequestInviteOtpState | null>(null);

  const showOtp =
    requestState.status === "otp_sent" && requestState !== backedOutState;

  if (showOtp && requestState.status === "otp_sent") {
    const sentEmail = requestState.email;
    const verifyError =
      verifyState.status === "error"
        ? verifyState.error === "invalid_otp"
          ? t("errors.invalidOtp")
          : verifyState.error === "rate_limited"
            ? t("errors.rateLimited")
            : t("errors.generic")
        : null;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("auth.otpTitle")}</h2>
        <OtpStep
          key={sentEmail}
          sentEmail={sentEmail}
          description={t("auth.otpDescription", { email: sentEmail })}
          tokenFieldName="otp"
          devOtp={requestState.devOtp}
          devMode={!!requestState.devOtp}
          verifyAction={dispatchVerify}
          verifyPending={verifyPending}
          verifyState={verifyState}
          errorMessage={verifyError}
          onBack={() => setBackedOutState(requestState)}
          onResend={() => {
            const fd = new FormData();
            fd.set("email", sentEmail);
            startTransition(() => dispatchRequest(fd));
          }}
          resendPending={requestPending}
          labels={{
            label: t("auth.otpLabel"),
            submit: t("auth.submitOtp"),
            verifying: t("auth.verifying"),
            back: t("auth.backToForm"),
            resend: t("auth.resend"),
            resent: t("auth.resent"),
            devMode: t("auth.devMode"),
          }}
        />
      </div>
    );
  }

  const requestError =
    requestState.status === "error"
      ? requestState.error === "invalid_email"
        ? t("errors.invalidEmail")
        : requestState.error === "rate_limited"
          ? t("errors.rateLimited")
          : t("errors.generic")
      : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("auth.joinTitle")}</h2>

      <form action={dispatchRequest} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-bold">
            {t("auth.emailLabel")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={
              requestState.status !== "idle" ? requestState.email : ""
            }
            className={INPUT_CLASS}
          />
        </div>

        {requestError && (
          <p className="text-destructive text-sm">{requestError}</p>
        )}

        <Button type="submit" className="w-full" disabled={requestPending}>
          {requestPending ? t("auth.submitting") : t("auth.submitWeiter")}
        </Button>
      </form>
    </div>
  );
}

export function InviteAcceptForm({
  token,
  hasProfile,
  accountName,
  accountEmail,
}: {
  token: string;
  hasProfile: boolean;
  accountName: string;
  accountEmail: string;
}) {
  const t = useInviteT();
  const acceptAction = acceptInvite.bind(null, token);

  const [acceptState, dispatchAccept, acceptPending] = useActionState<
    AcceptInviteState,
    FormData
  >(acceptAction, { status: "idle" });

  const errorMsg =
    acceptState.status === "error"
      ? acceptState.error === "drawn"
        ? t("errors.drawn")
        : acceptState.error === "rate_limited"
          ? t("errors.rateLimited")
          : acceptState.error === "missing_name"
            ? t("errors.missingName")
            : t("errors.generic")
      : null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("accept.title")}</h2>

      <div className="text-muted-foreground text-sm" data-testid="signed-in-as">
        <p>
          {t("signedInAs", {
            name: accountName || accountEmail,
            email: accountEmail,
          })}
        </p>
        <form action={signOutToInvite.bind(null, token)}>
          <button
            type="submit"
            className="py-1 underline underline-offset-4 hover:no-underline"
          >
            {t("notYou")}
          </button>
        </form>
      </div>

      <form action={dispatchAccept} className="space-y-4">
        {!hasProfile && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="firstName" className="text-sm font-bold">
                {t("accept.firstNameLabel")}
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lastName" className="text-sm font-bold">
                {t("accept.lastNameLabel")}
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
                className={INPUT_CLASS}
              />
            </div>
            <p className="text-muted-foreground col-span-2 text-xs">
              {t("accept.lastNameNote")}
            </p>
          </div>
        )}

        {errorMsg && <p className="text-destructive text-sm">{errorMsg}</p>}

        <Button type="submit" className="w-full" disabled={acceptPending}>
          {acceptPending ? t("accept.accepting") : t("accept.submitJoin")}
        </Button>
      </form>
    </div>
  );
}
