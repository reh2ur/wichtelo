import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const errorMock = vi.fn();
const withMetadataMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: { withMetadata: (...args: unknown[]) => withMetadataMock(...args) },
}));

import { reportError } from "./report-error";

beforeEach(() => {
  captureException.mockReset();
  errorMock.mockReset();
  withMetadataMock.mockReset().mockReturnValue({ error: errorMock });
});

describe("reportError", () => {
  it("logs at error level with full metadata and reports to Sentry once", () => {
    reportError("draw.failed", new Error("db down"), { groupId: "g1" });

    expect(errorMock).toHaveBeenCalledWith("draw.failed");
    expect(withMetadataMock.mock.calls[0][0]).toMatchObject({
      groupId: "g1",
      reason: "db down",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [exc, hint] = captureException.mock.calls[0];
    expect(exc).toBeInstanceOf(Error);
    expect(exc.message).toBe("db down");
    expect(hint).toMatchObject({
      level: "error",
      tags: { event: "draw.failed" },
      fingerprint: ["draw.failed"],
      extra: { groupId: "g1" },
    });
  });

  it("redacts emails and invite tokens, drops PII-bearing meta keys", () => {
    reportError(
      "notification.failed",
      {
        message:
          "bad recipient max@example.com via /einladung/abcSECRETtoken?token=xyz",
      },
      {
        eventType: "draw.completed",
        to: "max@example.com",
        adminEmail: "anna@example.com",
        userId: "u1",
        groupName: "Familie Mueller",
        note: "contact anna@example.com",
        nested: { a: 1 },
      },
    );

    const [exc, hint] = captureException.mock.calls[0];
    const payload = JSON.stringify({
      msg: exc.message,
      stack: exc.stack,
      hint,
    });
    expect(payload).not.toContain("example.com");
    expect(payload).not.toContain("abcSECRETtoken");
    expect(payload).not.toContain("xyz");
    expect(payload).not.toContain("Mueller");
    expect(payload).not.toContain('"u1"');
    expect(hint.extra).toEqual({
      eventType: "draw.completed",
      to: "[email]",
      note: "contact [email]",
    });
  });

  it("wraps non-Error values (Supabase/Resend payloads) into an Error", () => {
    reportError("health.db_unreachable", { message: "timeout", code: "PGRST" });
    const [exc, hint] = captureException.mock.calls[0];
    expect(exc).toBeInstanceOf(Error);
    expect(exc.message).toBe("timeout");
    expect(hint.extra).toEqual({ code: "PGRST" });
  });

  it("never throws when logger or Sentry fail", () => {
    withMetadataMock.mockImplementation(() => {
      throw new Error("logger broke");
    });
    captureException.mockImplementation(() => {
      throw new Error("sentry broke");
    });
    expect(() => reportError("x", new Error("e"))).not.toThrow();
  });
});
