import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const chain = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  return { logger: { ...chain, withMetadata: vi.fn().mockReturnValue(chain) } };
});
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  linkPreviewLimiter: { name: "link-preview" },
}));
vi.mock("@/lib/link-preview", () => ({ loadLinkPreview: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, linkPreviewLimiter } from "@/lib/rate-limit";
import { loadLinkPreview } from "@/lib/link-preview";
import { logger } from "@/lib/logger";
import { fetchLinkPreview } from "./actions";

function login(user: { id: string } | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

describe("fetchLinkPreview", () => {
  it("requires login", async () => {
    login(null);
    await expect(fetchLinkPreview("https://shop.example/")).rejects.toThrow(
      "NEXT_REDIRECT:/anmelden",
    );
    expect(loadLinkPreview).not.toHaveBeenCalled();
  });

  it("rate limits per account id, never by URL or email", async () => {
    login({ id: "user-1" });
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const out = await fetchLinkPreview("https://shop.example/p?token=secret");
    expect(out).toEqual({ status: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith(linkPreviewLimiter, "user-1");
    expect(loadLinkPreview).not.toHaveBeenCalled();
  });

  it("returns the preview, normalising bare hosts, internal off by default", async () => {
    login({ id: "user-1" });
    vi.mocked(loadLinkPreview).mockResolvedValue({
      ok: true,
      preview: {
        title: "T",
        imageUrl: "https://c.example/i.jpg",
        price: "9.90",
      },
    });
    const out = await fetchLinkPreview("shop.example/x");
    expect(out).toEqual({
      status: "ok",
      title: "T",
      imageUrl: "https://c.example/i.jpg",
      price: "9.90",
    });
    expect(loadLinkPreview).toHaveBeenCalledWith("https://shop.example/x", {
      allowInternal: false,
    });
  });

  it("failures degrade to none and never log the URL", async () => {
    login({ id: "user-1" });
    vi.mocked(loadLinkPreview).mockResolvedValue({
      ok: false,
      reason: "blocked",
    });
    const out = await fetchLinkPreview("https://shop.example/p?token=secret");
    expect(out).toEqual({ status: "none" });
    expect(
      JSON.stringify(vi.mocked(logger.withMetadata).mock.calls),
    ).not.toContain("secret");
  });

  it("invalid / non-http input → none without fetching", async () => {
    login({ id: "user-1" });
    for (const bad of [
      "javascript:alert(1)",
      "",
      "not a url",
      "ftp://x.example",
    ]) {
      expect(await fetchLinkPreview(bad)).toEqual({ status: "none" });
    }
    expect(loadLinkPreview).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
