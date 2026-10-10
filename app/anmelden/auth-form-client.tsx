"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { OtpStep } from "@/components/otp-step";
import {
  requestOtp,
  verifyOtp,
  type RequestOtpState,
  type VerifyOtpState,
} from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";

const { Provider: SignInProvider, useT: useSignInT } =
  createIntlContext("signIn");

export { SignInProvider };

export function AuthFormClient({ next }: { next: string }) {
  const t = useSignInT();
  const [requestState, requestAction, requestPending] = useActionState<
    RequestOtpState,
    FormData
  >(requestOtp, { status: "idle" });
  const [verifyState, verifyAction, verifyPending] = useActionState<
    VerifyOtpState,
    FormData
  >(verifyOtp, { status: "idle" });

  // Remember the exact request result the user backed out of. Every new
  // submit yields a fresh state object, so resubmitting the same email shows
  // the OTP step again.
  const [backedOutState, setBackedOutState] = useState<RequestOtpState | null>(
    null,
  );

  const showOtp =
    requestState.status === "otp_sent" && requestState !== backedOutState;

  const sentEmail =
    requestState.status === "otp_sent" ? requestState.email : "";

  if (showOtp && requestState.status === "otp_sent") {
    const verifyError =
      verifyState.status === "error"
        ? verifyState.error === "rate_limited"
          ? t("errors.rateLimited")
          : t("errors.invalidOtp")
        : null;
    return (
      <OtpStep
        key={sentEmail}
        sentEmail={sentEmail}
        description={`${t("otp.sentPrefix")} ${sentEmail} ${t("otp.sentSuffix")}`}
        tokenFieldName="token"
        hiddenFields={{ next }}
        devOtp={requestState.devOtp}
        devMode={!!requestState.devMode}
        verifyAction={verifyAction}
        verifyPending={verifyPending}
        verifyState={verifyState}
        errorMessage={verifyError}
        onBack={() => setBackedOutState(requestState)}
        onResend={() => {
          const fd = new FormData();
          fd.set("email", sentEmail);
          fd.set("next", next);
          startTransition(() => requestAction(fd));
        }}
        resendPending={requestPending}
        labels={{
          label: t("otp.label"),
          submit: t("otp.submit"),
          verifying: t("otp.verifying"),
          back: t("otp.back"),
          resend: t("otp.resend"),
          resent: t("otp.resent"),
          devMode: t("otp.devMode"),
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("description")}</p>

      <form action={requestAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-bold">
            {t("email.label")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder={t("email.placeholder")}
            autoComplete="email"
            defaultValue={
              requestState.status === "error" ? requestState.email : ""
            }
            required
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-lg border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {requestState.status === "error" && (
          <p className="text-danger-text text-sm">
            {requestState.error === "invalid_email"
              ? t("errors.invalidEmail")
              : requestState.error === "rate_limited"
                ? t("errors.rateLimited")
                : t("errors.generic")}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={requestPending}>
          {requestPending ? t("email.sending") : t("email.submit")}
        </Button>
      </form>
    </div>
  );
}
