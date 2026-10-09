import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (key: string) => {
      if (key === "host") return "localhost:3000";
      if (key === "x-forwarded-proto") return "http";
      if (key === "x-e2e-secret") return "test-secret";
      return null;
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue(true),
    // Distinct sentinels: real limiters are null without Redis, which would
    // make them indistinguishable in assertions.
    anmeldenOtpRequestLimiter: { name: "anmelden-email" },
    anmeldenOtpRequestIpLimiter: { name: "anmelden-ip" },
    anmeldenOtpVerifyLimiter: { name: "anmelden-verify" },
  };
});

import { requestOtp, verifyOtp } from "./actions";
import {
  checkRateLimit,
  anmeldenOtpRequestLimiter,
  anmeldenOtpRequestIpLimiter,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("requestOtp", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "test-secret");
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns invalid_email for empty email", async () => {
    expect(await requestOtp({ status: "idle" }, fd({ email: "" }))).toEqual({
      status: "error",
      error: "invalid_email",
      email: "",
    });
  });

  it("returns invalid_email for malformed email", async () => {
    expect(
      await requestOtp({ status: "idle" }, fd({ email: "notanemail" })),
    ).toEqual({
      status: "error",
      error: "invalid_email",
      email: "notanemail",
    });
  });

  it("returns invalid_email for email missing domain part", async () => {
    expect(
      await requestOtp({ status: "idle" }, fd({ email: "user@" })),
    ).toEqual({
      status: "error",
      error: "invalid_email",
      email: "user@",
    });
  });

  it("rate limits per normalized email and per IP backstop", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({ data: { users: [] } }),
        },
      },
    } as unknown as AdminClient);
    await requestOtp({ status: "idle" }, fd({ email: "  Foo@Example.COM " }));
    const calls = vi.mocked(checkRateLimit).mock.calls;
    expect(calls).toContainEqual([
      anmeldenOtpRequestLimiter,
      "foo@example.com",
    ]);
    expect(calls.some(([l]) => l === anmeldenOtpRequestIpLimiter)).toBe(true);
  });

  it("returns rate_limited when either limit is exceeded", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(
      await requestOtp({ status: "idle" }, fd({ email: "a@example.com" })),
    ).toEqual({
      status: "error",
      error: "rate_limited",
      email: "a@example.com",
    });
    vi.mocked(checkRateLimit).mockImplementation(
      async (l) => l !== anmeldenOtpRequestLimiter,
    );
    expect(
      (await requestOtp({ status: "idle" }, fd({ email: "a@example.com" })))
        .status,
    ).toBe("error");
  });

  it("returns otp_sent with devOtp in non-prod for an existing account", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ email: "user@example.com" }] },
            error: null,
          }),
          generateLink: vi.fn().mockResolvedValue({
            data: { properties: { email_otp: "123456" } },
            error: null,
          }),
        },
      },
    } as unknown as AdminClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "user@example.com" }),
    );
    expect(result).toEqual({
      status: "otp_sent",
      email: "user@example.com",
      devOtp: "123456",
      devMode: true,
    });
  });

  it("returns otp_sent (without devOtp) in non-prod for an email with no existing account, without creating one", async () => {
    const generateLink = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [] },
            error: null,
          }),
          generateLink,
        },
      },
    } as unknown as AdminClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "notarealuser@example.com" }),
    );
    expect(result).toEqual({
      status: "otp_sent",
      email: "notarealuser@example.com",
      devMode: true,
    });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("returns otp_sent when signInWithOtp fails in prod (unknown email), masking non-existence", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({
          error: {
            message: "Signups not allowed for otp",
            status: 422,
            code: "otp_disabled",
          },
        }),
      },
    } as unknown as SupabaseClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "unknown@example.com" }),
    );
    expect(result).toEqual({
      status: "otp_sent",
      email: "unknown@example.com",
    });
    vi.unstubAllEnvs();
  });

  it("returns generic error when signInWithOtp fails with a genuine send failure in prod (e.g. Supabase's own email rate limit) instead of masking it as otp_sent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({
          error: {
            message: "Email rate limit exceeded",
            status: 429,
            code: "over_email_send_rate_limit",
          },
        }),
      },
    } as unknown as SupabaseClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "fresh@example.com" }),
    );
    expect(result).toEqual({
      status: "error",
      error: "generic",
      email: "fresh@example.com",
    });
    vi.unstubAllEnvs();
  });

  it("passes shouldCreateUser: false and returns otp_sent in prod (known email)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as unknown as SupabaseClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "known@example.com" }),
    );
    expect(result).toEqual({ status: "otp_sent", email: "known@example.com" });
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ shouldCreateUser: false }),
      }),
    );
    vi.unstubAllEnvs();
  });

  it("passes shouldCreateUser: true for SUPER_ADMIN_EMAIL in prod", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("SUPER_ADMIN_EMAIL", "admin@example.com");
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as unknown as SupabaseClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "admin@example.com" }),
    );
    expect(result).toEqual({ status: "otp_sent", email: "admin@example.com" });
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ shouldCreateUser: true }),
      }),
    );
    vi.unstubAllEnvs();
  });

  it("returns identically-shaped otp_sent state for existing vs non-existing accounts (no enumeration)", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [] },
            error: null,
          }),
          generateLink: vi.fn(),
        },
      },
    } as unknown as AdminClient);
    const noAccountResult = await requestOtp(
      { status: "idle" },
      fd({ email: "nobody@example.com" }),
    );

    expect(noAccountResult.status).toBe("otp_sent");
    if (noAccountResult.status === "otp_sent") {
      expect(noAccountResult.devOtp).toBeUndefined();
      // devMode must still be true so the dev banner renders identically to
      // the existing-account case — otherwise its presence/absence becomes
      // a new account-existence oracle on preview deployments.
      expect(noAccountResult.devMode).toBe(true);
    }
  });

  it("returns generic error when admin generateLink fails", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ email: "user@example.com" }] },
            error: null,
          }),
          generateLink: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "Service unavailable",
              status: 503,
              code: "service_unavailable",
            },
          }),
        },
      },
    } as unknown as AdminClient);

    const result = await requestOtp(
      { status: "idle" },
      fd({ email: "user@example.com" }),
    );
    expect(result).toEqual({
      status: "error",
      error: "generic",
      email: "user@example.com",
    });
  });
});

describe("verifyOtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("redirects to /gruppen on success", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) },
    } as unknown as SupabaseClient);

    await expect(
      verifyOtp(
        { status: "idle" },
        fd({ email: "user@example.com", token: "123456" }),
      ),
    ).rejects.toThrow("REDIRECT:/gruppen");
  });

  it("returns invalid_otp on failure", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        verifyOtp: vi
          .fn()
          .mockResolvedValue({ error: { message: "Invalid OTP" } }),
      },
    } as unknown as SupabaseClient);

    const result = await verifyOtp(
      { status: "idle" },
      fd({ email: "user@example.com", token: "wrong" }),
    );
    expect(result).toEqual({
      status: "error",
      error: "invalid_otp",
      email: "user@example.com",
    });
  });
});
