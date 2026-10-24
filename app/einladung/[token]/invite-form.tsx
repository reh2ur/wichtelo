"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { OtpStep } from "@/components/otp-step";
import { FormError, errorFieldProps } from "@/components/form-error";
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

type OtpSentState = Extract<RequestInviteOtpState, { status: "otp_sent" }>;

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

  // Last successful send the OTP step belongs to. Kept separately from
  // requestState: a failed resend (e.g. throttled) replaces requestState with
  // an error, but the earlier code is still valid, so the step must stay
  // mounted and show the error inline. null = user backed out / not yet sent.
  const [otpSent, setOtpSent] = useState<OtpSentState | null>(null);
  // Request result the user backed out of: a stale resend error from it must
  // not show up on the email form.
  const [backedOutState, setBackedOutState] =
    useState<RequestInviteOtpState | null>(null);
  const [handledRequestState, setHandledRequestState] = useState(requestState);
  if (requestState !== handledRequestState) {
    setHandledRequestState(requestState);
    if (requestState.status === "otp_sent") setOtpSent(requestState);
  }

  if (otpSent) {
    const sentEmail = otpSent.email;
    const verifyError =
      verifyState.status === "error"
        ? verifyState.error === "invalid_otp"
          ? t("errors.invalidOtp")
          : verifyState.error === "rate_limited"
            ? t("errors.verifyRateLimited")
            : t("errors.generic")
        : null;
    const resendError =
      requestState.status === "error"
        ? requestState.error === "rate_limited"
          ? t("errors.resendRateLimited")
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
          devOtp={otpSent.devOtp}
          devMode={!!otpSent.devOtp}
          verifyAction={dispatchVerify}
          verifyPending={verifyPending}
          verifyState={verifyState}
          errorMessage={verifyError}
          onBack={() => {
            setOtpSent(null);
            setBackedOutState(requestState);
          }}
          onResend={() => {
            const fd = new FormData();
            fd.set("email", sentEmail);
            fd.set("resend", "1");
            startTransition(() => dispatchRequest(fd));
          }}
          resendPending={requestPending}
          sendId={otpSent}
          resendError={resendError}
          labels={{
            label: t("auth.otpLabel"),
            submit: t("auth.submitOtp"),
            verifying: t("auth.verifying"),
            back: t("auth.backToForm"),
            resend: t("auth.resend"),
            resendIn: (seconds) => t("auth.resendIn", { seconds }),
            resent: t("auth.resent"),
            devMode: t("auth.devMode"),
          }}
        />
      </div>
    );
  }

  const formState = requestState !== backedOutState ? requestState : null;
  const requestError =
    formState?.status === "error"
      ? formState.error === "invalid_email"
        ? t("errors.invalidEmail")
        : formState.error === "rate_limited"
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
            {...errorFieldProps("email-error", requestError !== null)}
            className={INPUT_CLASS}
          />
        </div>

        <FormError id="email-error">{requestError}</FormError>

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
                {...errorFieldProps(
                  "accept-error",
                  acceptState.status === "error" &&
                    acceptState.error === "missing_name",
                )}
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

        <FormError id="accept-error">{errorMsg}</FormError>

        <Button type="submit" className="w-full" disabled={acceptPending}>
          {acceptPending ? t("accept.accepting") : t("accept.submitJoin")}
        </Button>
      </form>
    </div>
  );
}
