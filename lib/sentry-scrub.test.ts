import { describe, expect, it } from "vitest";
import { scrubSentryData, scrubString } from "./sentry-scrub";

describe("scrubString", () => {
  it("rewrites invite paths in paths and full URLs", () => {
    expect(scrubString("/einladung/abc123XYZ")).toBe("/einladung/[token]");
    expect(scrubString("https://example.com/einladung/abc-_1?x=1#h")).toBe(
      "https://example.com/einladung/[token]?x=1#h",
    );
    expect(scrubString("GET /einladung/abc123 failed")).toBe(
      "GET /einladung/[token] failed",
    );
  });

  it("keeps the static invalid-token page and is idempotent", () => {
    expect(scrubString("/einladung/ungueltig")).toBe("/einladung/ungueltig");
    expect(scrubString("/einladung/[token]")).toBe("/einladung/[token]");
    expect(scrubString(scrubString("/einladung/abc"))).toBe(
      "/einladung/[token]",
    );
  });

  it("scrubs a token that merely starts with ungueltig", () => {
    expect(scrubString("/einladung/ungueltigXYZ")).toBe("/einladung/[token]");
  });

  it("filters ?token= query params", () => {
    expect(scrubString("/auth?token=secret&a=1")).toBe(
      "/auth?token=[Filtered]&a=1",
    );
    expect(scrubString("/x?a=1&token=secret")).toBe("/x?a=1&token=[Filtered]");
  });

  it("leaves other strings alone", () => {
    expect(scrubString("/gruppen/familie-2026")).toBe("/gruppen/familie-2026");
  });
});

describe("scrubSentryData", () => {
  it("scrubs nested event, transaction and breadcrumb fields", () => {
    const event = {
      transaction: "GET /einladung/tok123",
      request: { url: "https://x.de/einladung/tok123?token=abc" },
      breadcrumbs: [
        {
          category: "navigation",
          data: { from: "/", to: "/einladung/tok123" },
        },
        { category: "fetch", data: { url: "/einladung/tok123" } },
      ],
      contexts: { trace: { data: { "http.target": "/einladung/tok123" } } },
      spans: [{ description: "navigation /einladung/tok123" }],
      level: "error",
      n: 1,
    };
    const out = scrubSentryData(event);
    const json = JSON.stringify(out);
    expect(json).not.toContain("tok123");
    expect(json).not.toContain("abc");
    expect(out.transaction).toBe("GET /einladung/[token]");
    expect(out.level).toBe("error");
    expect(out.n).toBe(1);
  });

  it("handles cycles and non-plain objects", () => {
    const a: Record<string, unknown> = { u: "/einladung/t1" };
    a.self = a;
    const err = new Error("/einladung/t2");
    const out = scrubSentryData({ a, err });
    expect(out.a.u).toBe("/einladung/[token]");
    expect(out.err).toBe(err);
  });
});
