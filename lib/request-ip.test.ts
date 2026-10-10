import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { getClientIp, normalizeIpKey } from "./request-ip";
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

describe("normalizeIpKey", () => {
  it("leaves IPv4 untouched", () => {
    expect(normalizeIpKey("1.2.3.4")).toBe("1.2.3.4");
  });

  it("collapses IPv6 addresses of the same /64 to one key", () => {
    const a = normalizeIpKey("2001:db8:abcd:12::1");
    const b = normalizeIpKey("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
  });

  it("separates different /64 prefixes", () => {
    expect(normalizeIpKey("2001:db8:abcd:12::1")).not.toBe(
      normalizeIpKey("2001:db8:abcd:13::1"),
    );
  });

  it("handles :: compression at the start, middle and end", () => {
    expect(normalizeIpKey("::1")).toBe("0:0:0:0::/64");
    expect(normalizeIpKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(normalizeIpKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("keys IPv4-mapped IPv6 as plain IPv4", () => {
    expect(normalizeIpKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("is case-insensitive", () => {
    expect(normalizeIpKey("2001:DB8:ABCD:12::1")).toBe(
      normalizeIpKey("2001:db8:abcd:12::2"),
    );
  });

  it("returns malformed input unchanged (lowercased)", () => {
    expect(normalizeIpKey("unknown")).toBe("unknown");
    expect(normalizeIpKey("zz::1")).toBe("zz::1");
    expect(normalizeIpKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
  });
});

describe("getClientIp IPv6 keying", () => {
  it("returns the /64 key for an IPv6 client", async () => {
    vi.mocked(headers).mockResolvedValue(
      makeHeaders({
        "x-vercel-forwarded-for": "2001:db8:abcd:12::99",
      }) as never,
    );
    await expect(getClientIp()).resolves.toBe("2001:db8:abcd:12::/64");
  });
});
