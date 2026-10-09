import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  drawTriggerLimiter: {},
  joinLeaveLimiter: {},
}));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});

import { triggerDraw, retriggerDraw, leaveGroup } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";

function fd(slug: string) {
  const f = new FormData();
  f.set("slug", slug);
  return f;
}

function setup(opts: {
  group: object | null;
  membership: { id: string; role: string } | null;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
    },
  } as never);
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn().mockImplementation((table: string) => {
      const data = table === "groups" ? opts.group : opts.membership;
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data, error: null }),
      };
      return chain;
    }),
  } as never);
}

describe.each([
  ["triggerDraw", triggerDraw, "open"],
  ["retriggerDraw", retriggerDraw, "drawn"],
] as const)("%s rate limiting (#181)", (_name, action, state) => {
  const group = { id: "g1", slug: "familie", state, draw_version: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
  });

  it("non-member does not consume any rate-limit budget", async () => {
    setup({ group, membership: null });
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns same error for unknown slug as for non-admin", async () => {
    setup({ group: null, membership: null });
    const res = await action({ status: "idle" }, fd("nope"));
    expect(res).toEqual({ status: "error", error: "not_admin" });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("admin is limited per slug and user", async () => {
    setup({ group, membership: { id: "m1", role: "admin" } });
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await action({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "familie:u1",
    );
  });
});

describe("leaveGroup rate limiting (#182)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns rate_limited per user before any DB work", async () => {
    setup({ group: null, membership: null });
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await leaveGroup({ status: "idle" }, fd("familie"));
    expect(res).toEqual({ status: "error", error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
