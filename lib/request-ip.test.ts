import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { getClientIp } from "./request-ip";
import { headers } from "next/headers";

function makeHeaders(values: Record<string, string>) {
  return { get: (key: string) => values[key] ?? null };
}

describe("getClientIp", () => {
  it("uses x-vercel-forwarded-for, taking the first entry", async () => {
    vi.mocked(headers).mockResolvedValue(
      makeHeaders({
        "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8",
      }) as never,
    );

    await expect(getClientIp()).resolves.toBe("1.2.3.4");
  });

  it("ignores client-spoofable x-forwarded-for", async () => {
    vi.mocked(headers).mockResolvedValue(
      makeHeaders({
        "x-forwarded-for": "9.9.9.9",
      }) as never,
    );

    await expect(getClientIp()).resolves.toBe("unknown");
  });

  it("falls back to x-real-ip when x-vercel-forwarded-for absent", async () => {
    vi.mocked(headers).mockResolvedValue(
      makeHeaders({ "x-real-ip": "10.0.0.1" }) as never,
    );

    await expect(getClientIp()).resolves.toBe("10.0.0.1");
  });

  it("returns 'unknown' when no IP headers present", async () => {
    vi.mocked(headers).mockResolvedValue(makeHeaders({}) as never);

    await expect(getClientIp()).resolves.toBe("unknown");
  });
});

// Issue #137: falling back to "unknown" collapses unrelated clients onto one
// shared rate-limit bucket in lib/rate-limit.ts. That failure mode must be
// observable, not silent.
describe("getClientIp 'unknown' fallback logging", () => {
  const warnMock = vi.fn();
  const withMetadataMock = vi.fn(() => ({ warn: warnMock }));

  beforeEach(() => {
    warnMock.mockClear();
    withMetadataMock.mockClear();
    vi.doMock("@/lib/logger", () => ({
      logger: { withMetadata: withMetadataMock },
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/logger");
    vi.resetModules();
  });

  it("logs a warning with header diagnostics when no trusted IP header is present", async () => {
    vi.resetModules();
    vi.mocked(headers).mockResolvedValue(makeHeaders({}) as never);
    const { getClientIp: getClientIpFresh } = await import("./request-ip");

    await expect(getClientIpFresh()).resolves.toBe("unknown");

    expect(withMetadataMock).toHaveBeenCalledWith({ hasForwardedFor: false });
    expect(warnMock).toHaveBeenCalledWith("request-ip.unknown_fallback");
  });

  it("flags when a spoofable x-forwarded-for was present but ignored", async () => {
    vi.resetModules();
    vi.mocked(headers).mockResolvedValue(
      makeHeaders({ "x-forwarded-for": "9.9.9.9" }) as never,
    );
    const { getClientIp: getClientIpFresh } = await import("./request-ip");

    await expect(getClientIpFresh()).resolves.toBe("unknown");

    expect(withMetadataMock).toHaveBeenCalledWith({ hasForwardedFor: true });
  });

  it("does not log when a trusted IP header is present", async () => {
    vi.resetModules();
    vi.mocked(headers).mockResolvedValue(
      makeHeaders({ "x-real-ip": "10.0.0.1" }) as never,
    );
    const { getClientIp: getClientIpFresh } = await import("./request-ip");

    await expect(getClientIpFresh()).resolves.toBe("10.0.0.1");

    expect(warnMock).not.toHaveBeenCalled();
  });
});
