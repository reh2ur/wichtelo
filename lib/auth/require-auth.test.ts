import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("./get-user", () => ({
  getUser: vi.fn(),
}));

import { requireAuth } from "./require-auth";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "./get-user";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function makeSupabase(claims: object | null = null) {
  return {
    auth: {
      getClaims: vi
        .fn()
        .mockResolvedValue({ data: claims ? { claims } : null }),
    },
  };
}

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /anmelden when no claims", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase() as unknown as SupabaseClient,
    );

    await expect(requireAuth()).rejects.toThrow("REDIRECT:/anmelden");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("redirects to /anmelden when claims present but getUser returns null (revoked session)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({}) as unknown as SupabaseClient,
    );
    vi.mocked(getUser).mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow("REDIRECT:/anmelden");
  });

  it("resolves when claims and user are present", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({}) as unknown as SupabaseClient,
    );
    vi.mocked(getUser).mockResolvedValue({ id: "user-1" } as never);

    await expect(requireAuth()).resolves.toBeUndefined();
  });
});
