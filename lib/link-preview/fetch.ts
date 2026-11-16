import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "./ip";
import { nodeTransport } from "./transport";

type FetchFailure =
  | "invalid_url"
  | "blocked"
  | "unreachable"
  | "http_error"
  | "not_html"
  | "too_many_redirects"
  | "timeout";

export type FetchHtmlResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: FetchFailure };

interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

interface TransportRequest {
  url: URL;
  address: string;
  family: number;
  headers: Record<string, string>;
  signal: AbortSignal;
  /** E2E only (`allowInternal`): accept the local dev server's self-signed cert. */
  insecureTls: boolean;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy: () => void;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FetchHtmlOptions {
  resolve?: Resolver;
  transport?: Transport;
  /**
   * E2E only: allow loopback / any port so a spec can serve a stub page.
   * Callers must gate this with `isTestBackdoorEnabled`.
   */
  allowInternal?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

const FETCH_DEFAULTS = {
  maxBytes: 256 * 1024,
  timeoutMs: 6000,
  maxRedirects: 3,
} as const;

const USER_AGENT = "Mozilla/5.0 (compatible; WichteloLinkPreview/1.0)";

const defaultResolve: Resolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

class Blocked extends Error {}

function assertAllowedUrl(url: URL, allowInternal: boolean): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Blocked("scheme");
  }
  if (url.username || url.password) throw new Blocked("credentials");
  // URL drops default ports, so any explicit port is non-standard.
  if (url.port && !allowInternal) throw new Blocked("port");
  const host = url.hostname.toLowerCase();
  if (!host) throw new Blocked("host");
  if (
    !allowInternal &&
    (host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal"))
  ) {
    throw new Blocked("host");
  }
}

/** Resolves once, rejects when ANY answer is non-public, returns the pinned address. */
async function resolveSafe(
  url: URL,
  resolve: Resolver,
  allowInternal: boolean,
): Promise<ResolvedAddress> {
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  const answers: ResolvedAddress[] =
    family > 0 ? [{ address: bare, family }] : await resolve(bare);
  if (answers.length === 0) throw new Error("no address");
  if (!allowInternal && !answers.every((a) => isPublicAddress(a.address))) {
    throw new Blocked("address");
  }
  return answers[0];
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    const room = maxBytes - size;
    chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += Math.min(chunk.length, room);
    if (size >= maxBytes) break;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * SSRF-hardened one-shot page fetch. Every hop (initial URL and each
 * redirect): http/https only, no credentials, no non-standard port, DNS
 * resolved once with every answer required public, connection pinned to that
 * address. Capped redirects, total timeout, response size cap (truncates),
 * HTML content types only, no cookies, identity encoding, generic UA.
 */
export async function fetchHtml(
  rawUrl: string,
  options: FetchHtmlOptions = {},
): Promise<FetchHtmlResult> {
  const resolve = options.resolve ?? defaultResolve;
  const transport = options.transport ?? nodeTransport;
  const allowInternal = options.allowInternal === true;
  const maxBytes = options.maxBytes ?? FETCH_DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? FETCH_DEFAULTS.maxRedirects;
  const signal = AbortSignal.timeout(
    options.timeoutMs ?? FETCH_DEFAULTS.timeoutMs,
  );

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  try {
    for (let hop = 0; ; hop++) {
      assertAllowedUrl(url, allowInternal);
      const { address, family } = await resolveSafe(
        url,
        resolve,
        allowInternal,
      );
      const res = await transport({
        url,
        address,
        family,
        signal,
        insecureTls: allowInternal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
          "accept-language": "de,en;q=0.8",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        res.destroy();
        const location = res.headers.location;
        const target = Array.isArray(location) ? location[0] : location;
        if (!target) return { ok: false, reason: "http_error" };
        if (hop >= maxRedirects) {
          return { ok: false, reason: "too_many_redirects" };
        }
        url = new URL(target, url);
        continue;
      }
      if (res.status !== 200) {
        res.destroy();
        return { ok: false, reason: "http_error" };
      }
      const rawType = res.headers["content-type"];
      const contentType = (Array.isArray(rawType) ? rawType[0] : rawType) ?? "";
      if (
        !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType.trim())
      ) {
        res.destroy();
        return { ok: false, reason: "not_html" };
      }
      try {
        const bytes = await readCapped(res.body, maxBytes);
        return {
          ok: true,
          html: decode(bytes, contentType),
          finalUrl: url.href,
        };
      } finally {
        res.destroy();
      }
    }
  } catch (err) {
    if (err instanceof Blocked) return { ok: false, reason: "blocked" };
    if (signal.aborted) return { ok: false, reason: "timeout" };
    // Deliberately no message/URL in the result: errors from DNS/sockets
    // embed the host, and fetched URLs must not reach logs/Sentry.
    if (err instanceof TypeError) return { ok: false, reason: "invalid_url" };
    return { ok: false, reason: "unreachable" };
  }
}
