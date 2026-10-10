import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const cookieGet = vi.fn();
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet, delete: cookieDelete })),
}));

vi.mock("@/lib/auth/email-link", () => ({ verifyEmailLink: vi.fn() }));

import { confirmSignInLink } from "./actions";
import { verifyEmailLink } from "@/lib/auth/email-link";
import { NEXT_COOKIE } from "@/lib/safe-next";

function fd(hash = "a".repeat(56)) {
  const f = new FormData();
  f.set("token_hash", hash);
  return f;
}

describe("confirmSignInLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyEmailLink).mockResolvedValue("ok");
    cookieGet.mockReturnValue(undefined);
  });

  it("redirects to /gruppen without a return-to cookie", async () => {
    await expect(confirmSignInLink(fd())).rejects.toThrow("REDIRECT:/gruppen");
  });

  it("redirects to the return-to path from the cookie and clears it", async () => {
    cookieGet.mockReturnValue({ value: "/gruppen/x?y=1" });
    await expect(confirmSignInLink(fd())).rejects.toThrow(
      "REDIRECT:/gruppen/x?y=1",
    );
    expect(cookieGet).toHaveBeenCalledWith(NEXT_COOKIE);
    expect(cookieDelete).toHaveBeenCalledWith({
      name: NEXT_COOKIE,
      path: "/auth",
    });
  });

  it.each(["//evil.example", "https://evil.example", "/a\\b"])(
    "ignores unsafe cookie value %s",
    async (value) => {
      cookieGet.mockReturnValue({ value });
      await expect(confirmSignInLink(fd())).rejects.toThrow(
        "REDIRECT:/gruppen",
      );
    },
  );

  it("redirects failures to /anmelden with the error flag and keeps the cookie", async () => {
    vi.mocked(verifyEmailLink).mockResolvedValue("link_invalid");
    cookieGet.mockReturnValue({ value: "/konto" });
    await expect(confirmSignInLink(fd())).rejects.toThrow(
      "REDIRECT:/anmelden?error=link_invalid",
    );
    expect(cookieDelete).not.toHaveBeenCalled();
  });
});
