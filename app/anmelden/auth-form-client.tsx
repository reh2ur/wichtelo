"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { OtpStep } from "@/components/otp-step";
import { FormError, errorFieldProps } from "@/components/form-error";
import {
  requestOtp,
  verifyOtp,
  type RequestOtpState,
  type VerifyOtpState,
} from "./actions";
import { createIntlContext } from "@/lib/create-intl-context";
import { useHydrated } from "@/lib/use-hydrated";

type OtpSentState = Extract<RequestOtpState, { status: "otp_sent" }>;

const { Provider: SignInProvider, useT: useSignInT } =
  createIntlContext("signIn");

export { SignInProvider };

export function AuthFormClient({ next }: { next: string }) {
  const t = useSignInT();
  const hydrated = useHydrated();
  const [requestState, requestAction, requestPending] = useActionState<
    RequestOtpState,
    FormData
  >(requestOtp, { status: "idle" });
  const [verifyState, verifyAction, verifyPending] = useActionState<
    VerifyOtpState,
    FormData
  >(verifyOtp, { status: "idle" });

  // Last successful send the OTP step belongs to. Kept separately from
  // requestState: a failed resend (e.g. throttled) replaces requestState with
  // an error, but the earlier code is still valid, so the step must stay
  // mounted and show the error inline. null = user backed out / not yet sent.
  // Adjusted during render (no effect) to avoid an extra render pass.
  const [otpSent, setOtpSent] = useState<OtpSentState | null>(null);
  // Request result the user backed out of: a stale resend error from it must
  // not show up on the email form.
  const [backedOutState, setBackedOutState] = useState<RequestOtpState | null>(
    null,
  );
  const [handledRequestState, setHandledRequestState] = useState(requestState);
  if (requestState !== handledRequestState) {
    setHandledRequestState(requestState);
    if (requestState.status === "otp_sent") setOtpSent(requestState);
  }

  if (otpSent) {
    const sentEmail = otpSent.email;
    const verifyError =
      verifyState.status === "error"
        ? verifyState.error === "rate_limited"
          ? t("errors.verifyRateLimited")
          : t("errors.invalidOtp")
        : null;
    const resendError =
      requestState.status === "error"
        ? requestState.error === "rate_limited"
          ? t("errors.resendRateLimited")
          : t("errors.generic")
        : null;
    return (
      <OtpStep
        key={sentEmail}
        sentEmail={sentEmail}
        description={`${t("otp.sentPrefix")} ${sentEmail} ${t("otp.sentSuffix")}`}
        tokenFieldName="token"
        hiddenFields={{ next }}
        devOtp={otpSent.devOtp}
        devMode={!!otpSent.devMode}
        verifyAction={verifyAction}
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
          fd.set("next", next);
          fd.set("resend", "1");
          startTransition(() => requestAction(fd));
        }}
        resendPending={requestPending}
        sendId={otpSent}
        resendError={resendError}
        labels={{
          label: t("otp.label"),
          submit: t("otp.submit"),
          verifying: t("otp.verifying"),
          back: t("otp.back"),
          resend: t("otp.resend"),
          resendIn: (seconds) => t("otp.resendIn", { seconds }),
          resent: t("otp.resent"),
          devMode: t("otp.devMode"),
        }}
      />
    );
  }

  const formError =
    requestState.status === "error" && requestState !== backedOutState
      ? requestState
      : null;

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
            defaultValue={formError ? formError.email : ""}
            required
            {...errorFieldProps("email-error", !!formError)}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-lg border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {formError && (
          <FormError id="email-error">
            {formError.error === "invalid_email"
              ? t("errors.invalidEmail")
              : formError.error === "rate_limited"
                ? t("errors.rateLimited")
                : t("errors.generic")}
          </FormError>
        )}

        {/* Disabled until hydrated: a pre-hydration submit is a native POST
            whose action result the prerendered shell cannot show. Disabled
            default button also blocks Enter-key implicit submit. */}
        <Button
          type="submit"
          className="w-full"
          disabled={!hydrated || requestPending}
        >
          {requestPending ? t("email.sending") : t("email.submit")}
        </Button>
      </form>
    </div>
  );
}
