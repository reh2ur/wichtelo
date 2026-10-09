import { headers } from "next/headers";
import { isProductionDeploy } from "@/lib/env";

interface SiteUrlInput {
  configured?: string;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  production: boolean;
}

/**
 * Pure resolver. Production uses the configured canonical origin only (never
 * request headers: a `*.vercel.app` alias or spoofed Host must not end up in
 * emailed links). Dev/preview derive the origin from the request.
 */
export function resolveSiteUrl(input: SiteUrlInput): string {
  const configured = input.configured?.trim().replace(/\/+$/, "");
  if (input.production) {
    if (!configured) throw new Error("NEXT_PUBLIC_SITE_URL is not set");
    return configured;
  }
  if (configured && !input.host && !input.forwardedHost) return configured;

  const host = input.forwardedHost ?? input.host ?? "localhost:3000";
  const proto = input.forwardedProto ?? "http";
  // 127.0.0.1 and localhost are equivalent locally, but Supabase's redirect
  // allowlist has localhost entries - normalize so the path is preserved.
  return `${proto}://${host.replace("127.0.0.1", "localhost")}`;
}

export function buildInviteUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/einladung/${token}`;
}

export async function getSiteUrl(): Promise<string> {
  const production = isProductionDeploy();
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (production) return resolveSiteUrl({ configured, production });
  const h = await headers();
  return resolveSiteUrl({
    configured,
    forwardedHost: h.get("x-forwarded-host"),
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
    production,
  });
}
