import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/invite", () => ({ resolveToken: vi.fn() }));
vi.mock("@/lib/auth/email-link", () => ({ verifyEmailLink: vi.fn() }));

import { confirmInviteLink } from "./actions";
import { resolveToken } from "@/lib/invite";
import { verifyEmailLink } from "@/lib/auth/email-link";

function form(tokenHash?: string) {
  const f = new FormData();
  if (tokenHash !== undefined) f.set("token_hash", tokenHash);
  return f;
}

async function run(token: string, formData: FormData) {
  try {
    await confirmInviteLink(token, formData);
  } catch (err) {
    return (err as Error).message;
  }
  return "no redirect";
}

function mockInvite(state: "open" | "drawn" | null) {
  vi.mocked(resolveToken).mockResolvedValue(
    state === null ? null : ({ group: { id: "g1", state } } as never),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvite("open");
  vi.mocked(verifyEmailLink).mockResolvedValue("ok");
});

describe("confirmInviteLink", () => {
  it("consumes the emailed token and returns to the invite page on success", async () => {
    expect(await run("inv-1", form("hash12345"))).toBe(
      "REDIRECT:/einladung/inv-1",
    );
    expect(resolveToken).toHaveBeenCalledWith("inv-1");
    expect(verifyEmailLink).toHaveBeenCalledWith("hash12345");
  });

  it.each([
    ["unknown/invalid invite", null],
    ["already drawn group", "drawn"],
  ] as const)(
    "does not burn the emailed token for a dead invite (%s)",
    async (_label, state) => {
      mockInvite(state);
      expect(await run("inv-1", form("hash12345"))).toBe(
        "REDIRECT:/einladung/inv-1",
      );
      expect(verifyEmailLink).not.toHaveBeenCalled();
    },
  );

  it.each(["link_invalid", "rate_limited"] as const)(
    "redirects back with ?error=%s on verification failure",
    async (result) => {
      vi.mocked(verifyEmailLink).mockResolvedValue(result);
      expect(await run("inv-1", form("hash12345"))).toBe(
        `REDIRECT:/einladung/inv-1?error=${result}`,
      );
    },
  );

  it("passes an empty hash on for verification when the field is missing", async () => {
    vi.mocked(verifyEmailLink).mockResolvedValue("link_invalid");
    expect(await run("inv-1", form())).toBe(
      "REDIRECT:/einladung/inv-1?error=link_invalid",
    );
    expect(verifyEmailLink).toHaveBeenCalledWith("");
  });

  it("propagates a DB error from the invite lookup instead of redirecting as valid", async () => {
    vi.mocked(resolveToken).mockRejectedValue(new Error("db down"));
    await expect(confirmInviteLink("inv-1", form("hash12345"))).rejects.toThrow(
      "db down",
    );
    expect(verifyEmailLink).not.toHaveBeenCalled();
  });
});
