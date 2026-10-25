import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/site-url", () => ({
  getSiteUrl: vi.fn().mockResolvedValue("https://wichtelo.test"),
}));
vi.mock("@/lib/account", () => ({
  issueDeletionToken: vi.fn(),
  findSoleAdminGroups: vi.fn(),
}));
vi.mock("@/lib/notification", () => ({ notify: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});
// Stateful stand-in for the 1/24h fixed window: one slot per identifier.
const used = new Set<string>();
vi.mock("@/lib/rate-limit", () => ({
  accountDeletionLimiter: {},
  checkRateLimit: vi.fn(async (_limiter: unknown, id: string) => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  }),
  refundRateLimit: vi.fn(async (_limiter: unknown, id: string) => {
    used.delete(id);
  }),
}));

import { requestAccountDeletion } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { issueDeletionToken, findSoleAdminGroups } from "@/lib/account";
import { notify } from "@/lib/notification";

function mockUser(user: { id: string; email?: string } | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

const sent = { sent: 1, failed: 0 };
const failed = { sent: 0, failed: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  used.clear();
  mockUser({ id: "u1", email: "u1@example.com" });
  vi.mocked(findSoleAdminGroups).mockResolvedValue([]);
  vi.mocked(issueDeletionToken).mockResolvedValue("tok");
  vi.mocked(notify).mockResolvedValue(sent);
});

describe("requestAccountDeletion", () => {
  it("sends the confirmation mail", async () => {
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
    expect(notify).toHaveBeenCalledWith({
      type: "account.deletion_requested",
      to: "u1@example.com",
      confirmUrl: "https://wichtelo.test/konto/delete/confirm?token=tok",
    });
  });

  it("requires a session", async () => {
    mockUser(null);
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "not_authenticated",
    });
  });

  it("returns generic for a user without email (no non-null assertion)", async () => {
    mockUser({ id: "u1" });
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "generic",
    });
    expect(issueDeletionToken).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("sole-admin rejection does not consume the rate limit (#136)", async () => {
    vi.mocked(findSoleAdminGroups).mockResolvedValueOnce([
      { groupId: "g1", name: "Familie", slug: "familie" },
    ]);
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "sole_admin",
      groups: ["Familie"],
    });
    // User promotes someone, retries right away: allowed.
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
  });

  it("a failed sole-admin check returns generic and keeps the limit slot (#138)", async () => {
    vi.mocked(findSoleAdminGroups).mockRejectedValueOnce(new Error("db down"));
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "generic",
    });
    expect(issueDeletionToken).not.toHaveBeenCalled();
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
  });

  it("allows a second request after email_failed (#136)", async () => {
    vi.mocked(notify).mockResolvedValueOnce(failed);
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "email_failed",
    });
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
  });

  it("still limits two successful sends within 24 h", async () => {
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "rate_limited",
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("maps an issueDeletionToken throw to generic and refunds the slot", async () => {
    vi.mocked(issueDeletionToken).mockRejectedValueOnce(new Error("auth down"));
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "generic",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
  });

  it("maps a notify throw to generic and refunds the slot", async () => {
    vi.mocked(notify).mockRejectedValueOnce(new Error("resend down"));
    expect(await requestAccountDeletion()).toEqual({
      status: "error",
      error: "generic",
    });
    expect(await requestAccountDeletion()).toEqual({ status: "sent" });
  });
});
