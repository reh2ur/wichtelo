"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
  resent: string;
  devMode: string;
};

/**
 * Shared OTP entry step for /anmelden and /einladung/[token].
 * Behaviour (label, focus, clearing rejected digits, resend) lives here so
 * both forms stay identical.
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
  labels: OtpStepLabels;
}) {
  const [otpValue, setOtpValue] = useState(devOtp ?? "");
  const [resent, setResent] = useState(false);

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
            aria-describedby="otp-description"
            autoFocus
            maxLength={6}
            name={tokenFieldName}
            value={otpValue}
            onChange={setOtpValue}
            autoComplete="one-time-code"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        {errorMessage && (
          <p className="text-destructive text-sm">{errorMessage}</p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={verifyPending || otpValue.length < 6}
        >
          {verifyPending ? labels.verifying : labels.submit}
        </Button>
      </form>

      {resent && !resendPending && (
        <p role="status" className="text-muted-foreground text-sm">
          {labels.resent}
        </p>
      )}

      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          className="text-muted-foreground py-1 text-sm underline-offset-4 hover:underline disabled:opacity-50"
          disabled={resendPending}
          onClick={() => {
            setResent(true);
            onResend();
          }}
        >
          {labels.resend}
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
