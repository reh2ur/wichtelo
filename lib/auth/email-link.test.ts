import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn().mockResolvedValue("1.2.3.4"),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  linkConfirmIpLimiter: { name: "link-confirm-ip" },
}));
vi.mock("@/lib/logger", () => ({
  logger: { withMetadata: () => ({ info: vi.fn(), error: vi.fn() }) },
}));

import {
  parseTokenHash,
  parseEmailLinkError,
  verifyEmailLink,
} from "./email-link";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const HASH = "a".repeat(56);

function mockVerify(result: unknown) {
  const verifyOtp = vi.fn().mockResolvedValue(result);
  vi.mocked(createClient).mockResolvedValue({
    auth: { verifyOtp },
  } as unknown as SupabaseClient);
  return verifyOtp;
}

describe("parseTokenHash", () => {
  it("accepts hex and url-safe base64 hashes", () => {
    expect(parseTokenHash(HASH)).toBe(HASH);
    expect(parseTokenHash("pkce_Ab-_09xyzABC")).toBe("pkce_Ab-_09xyzABC");
  });

  it("trims whitespace", () => {
    expect(parseTokenHash(`  ${HASH} `)).toBe(HASH);
  });

  it.each([
    undefined,
    null,
    "",
    "short",
    "has space in it here",
    "../../etc",
    "x".repeat(201),
    ["a", "b"],
  ])("rejects %j", (value) => {
    expect(parseTokenHash(value as string)).toBeNull();
  });
});

describe("parseEmailLinkError", () => {
  it("passes known flags and drops everything else", () => {
    expect(parseEmailLinkError("link_invalid")).toBe("link_invalid");
    expect(parseEmailLinkError("rate_limited")).toBe("rate_limited");
    expect(parseEmailLinkError("<script>")).toBeNull();
    expect(parseEmailLinkError(undefined)).toBeNull();
    expect(parseEmailLinkError(["link_invalid"])).toBeNull();
  });
});

describe("verifyEmailLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
  });

  it("verifies with token_hash and type email", async () => {
    const verifyOtp = mockVerify({ error: null });
    expect(await verifyEmailLink(HASH)).toBe("ok");
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: HASH,
      type: "email",
    });
  });

  it("rejects a malformed hash without calling Supabase", async () => {
    const verifyOtp = mockVerify({ error: null });
    expect(await verifyEmailLink("nope")).toBe("link_invalid");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("returns link_invalid when verification fails (expired/used)", async () => {
    mockVerify({ error: { status: 403, code: "otp_expired", message: "x" } });
    expect(await verifyEmailLink(HASH)).toBe("link_invalid");
  });

  it("returns rate_limited on the per-IP limit without calling Supabase", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const verifyOtp = mockVerify({ error: null });
    expect(await verifyEmailLink(HASH)).toBe("rate_limited");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("maps a Supabase 429 to rate_limited", async () => {
    mockVerify({ error: { status: 429, code: "over_request_rate_limit" } });
    expect(await verifyEmailLink(HASH)).toBe("rate_limited");
  });
});
