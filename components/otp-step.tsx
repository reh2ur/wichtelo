"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS } from "@/lib/auth/otp";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export type OtpStepLabels = {
  label: string;
  submit: string;
  verifying: string;
  back: string;
  resend: string;
  /** Resend button text while cooling down; receives the seconds left. */
  resendIn: (seconds: number) => string;
  resent: string;
  devMode: string;
};

/**
 * Shared OTP entry step for /anmelden and /einladung/[token].
 * Behaviour (label, focus, clearing rejected digits, resend + cooldown) lives
 * here so both forms stay identical.
 *
 * The step stays mounted while a resend fails: the previously sent code is
 * still valid, so the failure is shown inline (`resendError`) instead of
 * dropping the user back to the email form.
 */
export function OtpStep({
  sentEmail,
  description,
  tokenFieldName,
  hiddenFields,
  devOtp,
  devMode,
  verifyAction,
  verifyPending,
  verifyState,
  errorMessage,
  onBack,
  onResend,
  resendPending,
  sendId,
  resendError,
  cooldownSeconds = OTP_RESEND_COOLDOWN_SECONDS,
  labels,
}: {
  sentEmail: string;
  description: ReactNode;
  tokenFieldName: string;
  /** Extra hidden inputs submitted with the code (e.g. a return-to path). */
  hiddenFields?: Record<string, string>;
  devOtp: string | undefined;
  devMode: boolean;
  verifyAction: (formData: FormData) => void;
  verifyPending: boolean;
  /** Result object of the verify action; identity changes on every attempt. */
  verifyState: unknown;
  /** Non-null when the last verify attempt failed. */
  errorMessage: string | null;
  onBack: () => void;
  onResend: () => void;
  resendPending: boolean;
  /**
   * Identity of the latest successful send (the `otp_sent` request state).
   * A change means a mail really went out: restarts the cooldown and shows
   * the "resent" confirmation. Failed resends keep the old value.
   */
  sendId: unknown;
  /** Non-null when the last resend attempt failed; shown inline. */
  resendError: string | null;
  /** Seconds before another resend is allowed (matches GoTrue max_frequency). */
  cooldownSeconds?: number;
  labels: OtpStepLabels;
}) {
  const [otpValue, setOtpValue] = useState(devOtp ?? "");
  const [initialSendId] = useState(sendId);
  const resent = sendId !== initialSendId;

  // Cooldown starts with the initial send (this step mounts right after it)
  // and restarts on every further successful send.
  const [secondsLeft, setSecondsLeft] = useState(cooldownSeconds);
  const [handledSendId, setHandledSendId] = useState(sendId);
  if (sendId !== handledSendId) {
    setHandledSendId(sendId);
    setSecondsLeft(cooldownSeconds);
  }
  const coolingDown = secondsLeft > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [coolingDown, sendId]);

  // Dev-mode autofill: pick up the fresh code on resend without remounting
  // (a remount via `key` would also wipe `resent`, hiding the confirmation).
  const [handledDevOtp, setHandledDevOtp] = useState(devOtp);
  if (devOtp !== handledDevOtp) {
    setHandledDevOtp(devOtp);
    if (devOtp) setOtpValue(devOtp);
  }

  // Reset the (rejected) code as soon as a new error state arrives, so the
  // stale digits don't linger for a retry. Adjusting state during render
  // (rather than in an effect) avoids an extra render pass.
  const [handledVerifyState, setHandledVerifyState] = useState(verifyState);
  if (verifyState !== handledVerifyState) {
    setHandledVerifyState(verifyState);
    if (errorMessage !== null && otpValue !== "") {
      setOtpValue("");
    }
  }

  useEffect(() => {
    if (errorMessage !== null) {
      document.getElementById("otp")?.focus();
    }
  }, [verifyState, errorMessage]);

  return (
    <div className="space-y-4">
      <p id="otp-description" className="text-muted-foreground text-sm">
        {description}
      </p>

      {devMode && (
        <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-xs dark:bg-amber-950">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            {labels.devMode}
          </p>
        </div>
      )}

      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="email" value={sentEmail} />
        {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        <div className="space-y-2">
          <label htmlFor="otp" className="text-sm font-bold">
            {labels.label}
          </label>
          <InputOTP
            id="otp"
            aria-describedby={
              errorMessage ? "otp-description otp-error" : "otp-description"
            }
            aria-invalid={errorMessage ? true : undefined}
            autoFocus
            maxLength={OTP_LENGTH}
            name={tokenFieldName}
            value={otpValue}
            onChange={setOtpValue}
            autoComplete="one-time-code"
          >
            <InputOTPGroup>
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                <InputOTPSlot key={i} index={i} className="size-7 sm:size-8" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <FormError id="otp-error">{errorMessage}</FormError>

        <Button
          type="submit"
          className="w-full"
          disabled={verifyPending || otpValue.length < OTP_LENGTH}
        >
          {verifyPending ? labels.verifying : labels.submit}
        </Button>
      </form>

      {resendError && !resendPending && (
        <p role="alert" className="text-danger-text text-sm">
          {resendError}
        </p>
      )}

      {resent && !resendError && !resendPending && (
        <p role="status" className="text-muted-foreground text-sm">
          {labels.resent}
        </p>
      )}

      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className="text-muted-foreground py-1 text-sm underline-offset-4 hover:underline disabled:no-underline disabled:opacity-50"
          disabled={resendPending || coolingDown}
          onClick={onResend}
        >
          {coolingDown ? labels.resendIn(secondsLeft) : labels.resend}
        </button>
        <button
          type="button"
          className="text-muted-foreground py-1 text-sm underline-offset-4 hover:underline"
          onClick={onBack}
        >
          {labels.back}
        </button>
      </div>
    </div>
  );
}
