import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const batchSendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  resend: {
    emails: { send: (...args: unknown[]) => sendMock(...args) },
    batch: { send: (...args: unknown[]) => batchSendMock(...args) },
  },
  FROM_EMAIL: "wichtelo@test.local",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withMetadata: () => ({ info: vi.fn(), error: vi.fn() }),
  },
}));

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { notify } from "./index";

const event = (n: number) =>
  ({
    type: "group.deleted",
    groupName: "Runde",
    year: 2026,
    adminName: "Anna",
    adminEmail: "anna@example.com",
    recipients: Array.from({ length: n }, (_, i) => ({
      to: `user${i}@example.com`,
      name: `User ${i}`,
    })),
  }) as const;

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ data: { id: "e" }, error: null });
  batchSendMock
    .mockReset()
    .mockResolvedValue({ data: { data: [] }, error: null });
  captureException.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("notify -> Sentry", () => {
  it("reports once per failed chunk after retries are exhausted, without PII", async () => {
    // 250 recipients = 3 chunks; first send succeeds, then everything fails
    // with a retryable 503 (chunk 1 exhausts retries; chunk 2 too).
    batchSendMock
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
      .mockResolvedValue({
        data: null,
        error: { message: "down for user1@example.com", statusCode: 503 },
      });
    const promise = notify(event(250));
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;

    expect(result.sent).toBe(100);
    expect(result.failed).toBe(150);
    expect(captureException).toHaveBeenCalledTimes(2);
    const [exc, hint] = captureException.mock.calls[0];
    expect(hint.tags.event).toBe("notification.failed");
    expect(hint.extra).toMatchObject({ chunk: 1 });
    expect(JSON.stringify({ m: exc.message, hint })).not.toContain(
      "example.com",
    );
  });

  it("does not report when delivery succeeds", async () => {
    await notify(event(3));
    expect(captureException).not.toHaveBeenCalled();
  });
});
