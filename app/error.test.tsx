// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import ErrorBoundary from "./error";
import messages from "@/messages/de.json";

beforeEach(() => {
  cleanup();
  captureException.mockReset();
});

describe("app/error.tsx", () => {
  it("reports the boundary error to Sentry and still renders the fallback", () => {
    const error = new Error("render exploded");
    render(<ErrorBoundary error={error} reset={() => {}} />);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
    expect(
      screen.getByRole("heading", { name: messages.errorPage.title }),
    ).toBeTruthy();
  });

  it("does not re-report on re-render with the same error", () => {
    const error = new Error("boom");
    const { rerender } = render(
      <ErrorBoundary error={error} reset={() => {}} />,
    );
    rerender(<ErrorBoundary error={error} reset={() => {}} />);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
