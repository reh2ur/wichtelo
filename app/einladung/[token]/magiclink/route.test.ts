import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/invite", () => ({
  resolveToken: vi.fn(),
}));

import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";
import { resolveToken } from "@/lib/invite";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

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

function req(token: string, code: string | null) {
  const url = new URL(`https://example.com/einladung/${token}/magiclink`);
  if (code) url.searchParams.set("code", code);
  return new Request(url);
}

describe("GET /einladung/[token]/magiclink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does not exchange the code for an invalid token", async () => {
    vi.mocked(resolveToken).mockResolvedValue(null);
    const exchangeCodeForSession = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as unknown as SupabaseClient);

    await GET(req("bogus-token", "some-code"), {
      params: Promise.resolve({ token: "bogus-token" }),
    });

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("does not exchange the code for a drawn-group token", async () => {
    vi.mocked(resolveToken).mockResolvedValue(drawnGroup);
    const exchangeCodeForSession = vi.fn();
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as unknown as SupabaseClient);

    await GET(req("drawn-token", "some-code"), {
      params: Promise.resolve({ token: "drawn-token" }),
    });

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("exchanges the code for a valid open-group token", async () => {
    vi.mocked(resolveToken).mockResolvedValue(openGroup);
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as unknown as SupabaseClient);

    const res = await GET(req("valid-token", "some-code"), {
      params: Promise.resolve({ token: "valid-token" }),
    });

    expect(exchangeCodeForSession).toHaveBeenCalledWith("some-code");
    expect(res.headers.get("location")).toBe(
      "https://example.com/einladung/valid-token",
    );
  });
});
