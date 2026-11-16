import { describe, expect, it, vi } from "vitest";
import {
  fetchHtml,
  type Resolver,
  type Transport,
  type TransportResponse,
} from "./fetch";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

function res(
  status: number,
  headers: Record<string, string> = {},
  body: string | Uint8Array[] = "",
): TransportResponse {
  const chunks =
    typeof body === "string" ? [new TextEncoder().encode(body)] : body;
  return {
    status,
    headers,
    body: (async function* () {
      yield* chunks;
    })(),
    destroy: vi.fn(),
  };
}

const html = (body = "<title>Hi</title>") =>
  res(200, { "content-type": "text/html; charset=utf-8" }, body);

function setup(opts: {
  answers?: typeof PUBLIC;
  responses?: TransportResponse[];
}) {
  const resolve = vi.fn<Resolver>(async () => opts.answers ?? PUBLIC);
  const queue = [...(opts.responses ?? [html()])];
  const transport = vi.fn<Transport>(async () => queue.shift()!);
  return { resolve, transport };
}

describe("fetchHtml: happy path", () => {
  it("returns the html and pins the validated address", async () => {
    const { resolve, transport } = setup({});
    const out = await fetchHtml("https://shop.example/p?x=1", {
      resolve,
      transport,
    });
    expect(out).toEqual({
      ok: true,
      html: "<title>Hi</title>",
      finalUrl: "https://shop.example/p?x=1",
    });
    const req = transport.mock.calls[0][0];
    expect(req.address).toBe("93.184.216.34");
    expect(req.headers.cookie).toBeUndefined();
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["accept-encoding"]).toBe("identity");
  });

  it("follows a public redirect", async () => {
    const { resolve, transport } = setup({
      responses: [res(301, { location: "/neu" }), html()],
    });
    const out = await fetchHtml("https://shop.example/alt", {
      resolve,
      transport,
    });
    expect(out).toMatchObject({
      ok: true,
      finalUrl: "https://shop.example/neu",
    });
  });

  it("truncates huge bodies instead of failing", async () => {
    const big = [new Uint8Array(100).fill(97), new Uint8Array(100).fill(98)];
    const { resolve, transport } = setup({
      responses: [res(200, { "content-type": "text/html" }, big)],
    });
    const out = await fetchHtml("https://shop.example/", {
      resolve,
      transport,
      maxBytes: 150,
    });
    expect(out.ok && out.html.length).toBe(150);
  });
});

describe("fetchHtml: SSRF", () => {
  const blockedUrls = [
    "http://localhost/",
    "http://foo.localhost/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00:ec2::254]/",
    "http://0.0.0.0/",
    "https://shop.example:8443/",
    "http://shop.example:22/",
    "ftp://shop.example/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pw@shop.example/",
  ];

  it.each(blockedUrls)("rejects %s without any request", async (url) => {
    const { resolve, transport } = setup({});
    const out = await fetchHtml(url, { resolve, transport });
    expect(out.ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a hostname resolving to a private address", async () => {
    const { resolve, transport } = setup({
      answers: [{ address: "10.0.0.1", family: 4 }],
    });
    const out = await fetchHtml("https://evil.example/", {
      resolve,
      transport,
    });
    expect(out).toEqual({ ok: false, reason: "blocked" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects when ANY answer is private (mixed A records)", async () => {
    const { resolve, transport } = setup({
      answers: [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    });
    const out = await fetchHtml("https://evil.example/", {
      resolve,
      transport,
    });
    expect(out).toEqual({ ok: false, reason: "blocked" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects redirect to an internal IP literal", async () => {
    const { resolve, transport } = setup({
      responses: [res(302, { location: "http://169.254.169.254/latest" })],
    });
    const out = await fetchHtml("https://shop.example/", {
      resolve,
      transport,
    });
    expect(out).toEqual({ ok: false, reason: "blocked" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect to a host that resolves internal", async () => {
    const resolveByHost = vi.fn<Resolver>(async (h) =>
      h === "rebind.example" ? [{ address: "127.0.0.1", family: 4 }] : PUBLIC,
    );
    const transport = vi.fn<Transport>(async () =>
      res(302, { location: "https://rebind.example/" }),
    );
    const out = await fetchHtml("https://shop.example/", {
      resolve: resolveByHost,
      transport,
    });
    expect(out).toEqual({ ok: false, reason: "blocked" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect to a non-http scheme or non-standard port", async () => {
    for (const location of [
      "file:///etc/passwd",
      "http://shop.example:6379/",
    ]) {
      const { resolve, transport } = setup({
        responses: [res(302, { location })],
      });
      const out = await fetchHtml("https://shop.example/", {
        resolve,
        transport,
      });
      expect(out).toEqual({ ok: false, reason: "blocked" });
    }
  });

  it("DNS rebinding: connects to the validated address, not a 2nd lookup", async () => {
    // First answer public, any later answer internal. The transport must be
    // handed the first (validated) address and the resolver asked only once.
    let calls = 0;
    const resolve = vi.fn<Resolver>(async () =>
      calls++ === 0 ? PUBLIC : [{ address: "127.0.0.1", family: 4 }],
    );
    const { transport } = setup({});
    await fetchHtml("https://rebind.example/", { resolve, transport });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].address).toBe("93.184.216.34");
  });

  it("caps redirects", async () => {
    const transport = vi.fn<Transport>(async () =>
      res(302, { location: "https://shop.example/again" }),
    );
    const out = await fetchHtml("https://shop.example/", {
      resolve: async () => PUBLIC,
      transport,
      maxRedirects: 3,
    });
    expect(out).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("allowInternal (E2E gate) permits loopback and ports", async () => {
    const { resolve, transport } = setup({
      answers: [{ address: "127.0.0.1", family: 4 }],
    });
    const out = await fetchHtml("http://localhost:3000/stub", {
      resolve,
      transport,
      allowInternal: true,
    });
    expect(out.ok).toBe(true);
  });
});

describe("fetchHtml: degradation", () => {
  it("rejects non-HTML content types", async () => {
    for (const type of [
      "application/json",
      "image/png",
      "application/pdf",
      "",
    ]) {
      const { resolve, transport } = setup({
        responses: [res(200, { "content-type": type }, "x")],
      });
      expect(
        await fetchHtml("https://shop.example/", { resolve, transport }),
      ).toEqual({
        ok: false,
        reason: "not_html",
      });
    }
  });

  it("maps HTTP errors, DNS failures and socket errors", async () => {
    const a = setup({ responses: [res(403)] });
    expect(await fetchHtml("https://shop.example/", a)).toEqual({
      ok: false,
      reason: "http_error",
    });

    const failingResolve: Resolver = async () => {
      throw new Error("getaddrinfo ENOTFOUND shop.example");
    };
    expect(
      await fetchHtml("https://shop.example/", {
        resolve: failingResolve,
        transport: vi.fn(),
      }),
    ).toEqual({ ok: false, reason: "unreachable" });

    expect(
      await fetchHtml("https://shop.example/", {
        resolve: async () => PUBLIC,
        transport: async () => {
          throw new Error("ECONNRESET");
        },
      }),
    ).toEqual({ ok: false, reason: "unreachable" });
  });

  it("times out", async () => {
    const out = await fetchHtml("https://shop.example/", {
      resolve: async () => PUBLIC,
      timeoutMs: 20,
      transport: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(out).toEqual({ ok: false, reason: "timeout" });
  });

  it("rejects garbage input", async () => {
    expect(await fetchHtml("not a url")).toEqual({
      ok: false,
      reason: "invalid_url",
    });
  });
});
