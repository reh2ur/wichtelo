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

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));

vi.mock("@/lib/notification", () => ({ notify: vi.fn() }));

vi.mock("@/lib/group-admins", () => ({
  getGroupAdminEmails: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/invite", () => ({
  resolveToken: vi.fn(),
}));

vi.mock("@/lib/request-ip", () => ({
  getClientIp: vi.fn().mockResolvedValue("1.2.3.4"),
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
    inviteOtpRequestLimiter: { name: "invite-email" },
    inviteOtpRequestIpLimiter: { name: "invite-ip" },
    inviteOtpVerifyLimiter: { name: "invite-verify" },
  };
});

import { requestInviteOtp, verifyInviteOtp, acceptInvite } from "./actions";
import { notify } from "@/lib/notification";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveToken } from "@/lib/invite";
import {
  checkRateLimit,
  inviteOtpRequestLimiter,
  inviteOtpRequestIpLimiter,
} from "@/lib/rate-limit";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const openGroup = {
  group: {
    id: "group-1",
    slug: "test-group",
    name: "Testgruppe",
    state: "open" as const,
    created_by: "admin-1",
    budget_hint: null,
    note: null,
  },
  adminName: "Admin Admin",
};

const drawnGroup = {
  ...openGroup,
  group: { ...openGroup.group, state: "drawn" as const },
};

describe("requestInviteOtp", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "test-secret");
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("masks invalid token as otp_sent without creating an account or sending mail", async () => {
    vi.mocked(resolveToken).mockResolvedValue(null);
    const generateLink = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { generateLink } },
    } as unknown as AdminClient);
    const signInWithOtp = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as unknown as SupabaseClient);

    const result = await requestInviteOtp(
      "bogus-token",
      { status: "idle" },
      fd({ email: "victim@example.com" }),
    );

    expect(result).toEqual({
      status: "otp_sent",
      email: "victim@example.com",
    });
    expect(generateLink).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("masks drawn-group token as otp_sent without creating an account or sending mail", async () => {
    vi.mocked(resolveToken).mockResolvedValue(drawnGroup);
    const signInWithOtp = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as unknown as SupabaseClient);
    const generateLink = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { generateLink } },
    } as unknown as AdminClient);

    const result = await requestInviteOtp(
      "drawn-token",
      { status: "idle" },
      fd({ email: "victim@example.com" }),
    );

    expect(result).toEqual({
      status: "otp_sent",
      email: "victim@example.com",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("calls signInWithOtp in prod for a valid open-group token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.mocked(resolveToken).mockResolvedValue(openGroup);
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as unknown as SupabaseClient);

    const result = await requestInviteOtp(
      "valid-token",
      { status: "idle" },
      fd({ email: "guest@example.com" }),
    );

    expect(result).toEqual({
      status: "otp_sent",
      email: "guest@example.com",
    });
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "guest@example.com" }),
    );
    vi.unstubAllEnvs();
  });
});

describe("requestInviteOtp rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(resolveToken).mockResolvedValue(null);
  });

  it("limits per normalized email plus per-IP backstop", async () => {
    await requestInviteOtp(
      "t",
      { status: "idle" },
      fd({ email: " Guest@Example.COM " }),
    );
    const calls = vi.mocked(checkRateLimit).mock.calls;
    expect(calls).toContainEqual([
      inviteOtpRequestLimiter,
      "guest@example.com",
    ]);
    expect(calls).toContainEqual([inviteOtpRequestIpLimiter, "1.2.3.4"]);
  });

  it("returns rate_limited when email limit exceeded", async () => {
    vi.mocked(checkRateLimit).mockImplementation(
      async (l) => l !== inviteOtpRequestLimiter,
    );
    const result = await requestInviteOtp(
      "t",
      { status: "idle" },
      fd({ email: "guest@example.com" }),
    );
    expect(result).toEqual({
      status: "error",
      error: "rate_limited",
      email: "guest@example.com",
    });
  });
});

describe("verifyInviteOtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects an invalid token without calling verifyOtp", async () => {
    vi.mocked(resolveToken).mockResolvedValue(null);
    const verifyOtp = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as SupabaseClient);

    const result = await verifyInviteOtp(
      "bogus-token",
      { status: "idle" },
      fd({ email: "victim@example.com", otp: "123456" }),
    );

    expect(result).toEqual({
      status: "error",
      error: "invalid_otp",
      email: "victim@example.com",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a drawn-group token without calling verifyOtp", async () => {
    vi.mocked(resolveToken).mockResolvedValue(drawnGroup);
    const verifyOtp = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as SupabaseClient);

    const result = await verifyInviteOtp(
      "drawn-token",
      { status: "idle" },
      fd({ email: "victim@example.com", otp: "123456" }),
    );

    expect(result).toEqual({
      status: "error",
      error: "invalid_otp",
      email: "victim@example.com",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("redirects on success for a valid open-group token", async () => {
    vi.mocked(resolveToken).mockResolvedValue(openGroup);
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as unknown as SupabaseClient);

    await expect(
      verifyInviteOtp(
        "valid-token",
        { status: "idle" },
        fd({ email: "guest@example.com", otp: "123456" }),
      ),
    ).rejects.toThrow("REDIRECT:/einladung/valid-token");
  });
});

describe("acceptInvite rate limit (#182)", () => {
  it("returns rate_limited per user before touching the group", async () => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);

    const result = await acceptInvite(
      "valid-token",
      { status: "idle" },
      fd({ firstName: "Max", lastName: "Muster" }),
    );

    expect(result).toEqual({ status: "error", error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.toSatisfy(() => true),
      "u1",
    );
    expect(resolveToken).not.toHaveBeenCalled();
  });
});

describe("acceptInvite name validation (#185)", () => {
  function arrange() {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1", email: "dora.secret-mail+x@example.com" } },
        }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(resolveToken).mockResolvedValue(openGroup);
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
        insert,
      })),
    } as unknown as AdminClient);
    return insert;
  }

  it.each([
    ["   ", "   "],
    ["Max", "   "],
    ["", "Muster"],
    ["x".repeat(51), "Muster"],
  ])("rejects first=%j last=%j without creating a profile", async (f, l) => {
    const insert = arrange();
    const result = await acceptInvite(
      "valid-token",
      { status: "idle" },
      fd({ firstName: f, lastName: l }),
    );
    expect(result).toEqual({ status: "error", error: "missing_name" });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("acceptInvite write-error handling", () => {
  function setup(opts: {
    profileInsertError?: { code?: string; message: string } | null;
    memberInsertError?: { code?: string; message: string } | null;
    existingProfile?: boolean;
  }) {
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1", email: "a@example.com" } },
        }),
      },
    } as unknown as SupabaseClient);
    vi.mocked(resolveToken).mockResolvedValue(openGroup);
    const table = (name: string) => {
      if (name === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: vi.fn().mockResolvedValue({
                data: opts.existingProfile
                  ? { id: "u1", first_name: "A", last_name: "B" }
                  : null,
              }),
            }),
          }),
          insert: vi
            .fn()
            .mockResolvedValue({ error: opts.profileInsertError ?? null }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ single: vi.fn().mockResolvedValue({ data: null }) }),
          }),
        }),
        insert: vi
          .fn()
          .mockResolvedValue({ error: opts.memberInsertError ?? null }),
      };
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: table,
    } as unknown as AdminClient);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns generic error when profile insert fails", async () => {
    setup({ profileInsertError: { code: "XX000", message: "boom" } });
    const result = await acceptInvite(
      "t",
      { status: "idle" },
      fd({ firstName: "A", lastName: "B" }),
    );
    expect(result).toEqual({ status: "error", error: "generic" });
  });

  it("treats a 23505 on membership insert as success (double submit)", async () => {
    setup({
      existingProfile: true,
      memberInsertError: { code: "23505", message: "duplicate" },
    });
    await expect(acceptInvite("t", { status: "idle" }, fd({}))).rejects.toThrow(
      "REDIRECT:/gruppen/test-group",
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("still reports other membership insert errors", async () => {
    setup({
      existingProfile: true,
      memberInsertError: { code: "XX000", message: "boom" },
    });
    const result = await acceptInvite("t", { status: "idle" }, fd({}));
    expect(result).toEqual({ status: "error", error: "generic" });
  });
});
