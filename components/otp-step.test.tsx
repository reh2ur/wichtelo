// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtpStep } from "./otp-step";
import { OTP_RESEND_COOLDOWN_SECONDS } from "@/lib/auth/otp";

const labels = {
  label: "Einmal-Code",
  submit: "Anmelden",
  verifying: "Wird überprüft…",
  back: "Andere E-Mail-Adresse",
  resend: "Code erneut senden",
  resendIn: (seconds: number) => `Code erneut senden in ${seconds} s`,
  resent: "Neuer Code geschickt.",
  devMode: "Dev",
};

type Props = Partial<React.ComponentProps<typeof OtpStep>>;

function step(props: Props = {}) {
  return (
    <OtpStep
      sentEmail="a@example.com"
      description="Code gesendet"
      tokenFieldName="token"
      devOtp={undefined}
      devMode={false}
      verifyAction={() => {}}
      verifyPending={false}
      verifyState={{ status: "idle" }}
      errorMessage={null}
      onBack={() => {}}
      onResend={() => {}}
      resendPending={false}
      sendId="send-1"
      resendError={null}
      labels={labels}
      {...props}
    />
  );
}

function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

describe("OtpStep resend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // input-otp probes password-manager badges on a timer; jsdom lacks it.
    document.elementFromPoint = () => null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("disables resend with a countdown for 60 s after the initial send", () => {
    render(step());
    const button = screen.getByRole("button", { name: /Code erneut senden/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(
      `Code erneut senden in ${OTP_RESEND_COOLDOWN_SECONDS} s`,
    );

    advance(OTP_RESEND_COOLDOWN_SECONDS - 1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Code erneut senden in 1 s");

    advance(1);
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent(/^Code erneut senden$/);
  });

  it("calls onResend when clicked after the cooldown", () => {
    const onResend = vi.fn();
    render(step({ onResend }));
    advance(OTP_RESEND_COOLDOWN_SECONDS);
    act(() =>
      screen.getByRole("button", { name: "Code erneut senden" }).click(),
    );
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("restarts the cooldown and confirms only after a really sent mail", () => {
    const { rerender } = render(step());
    advance(OTP_RESEND_COOLDOWN_SECONDS);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(step({ sendId: "send-2" }));
    expect(screen.getByRole("status")).toHaveTextContent(labels.resent);
    expect(
      screen.getByRole("button", { name: /Code erneut senden in 60 s/ }),
    ).toBeDisabled();
  });

  it("keeps the code field and shows the error inline when a resend fails", () => {
    const { rerender } = render(step());
    advance(OTP_RESEND_COOLDOWN_SECONDS);

    // Resend returned rate_limited: sendId unchanged, error set.
    rerender(step({ resendError: "Bitte warte etwa eine Minute." }));

    expect(screen.getByLabelText(labels.label)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte warte etwa eine Minute.",
    );
    // No false "new code sent" confirmation, no restarted cooldown.
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Code erneut senden" }),
    ).toBeEnabled();
  });

  it("hides the previous resend error while a new resend is pending", () => {
    render(step({ resendError: "Fehler", resendPending: true }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
