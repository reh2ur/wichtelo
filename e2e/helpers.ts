import { type Browser, type BrowserContext } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://localhost:3000";

// Headers for browser contexts: Vercel deployment-protection bypass plus the
// shared secret that unlocks server-side E2E backdoors (devOtp).
function browserExtraHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  if (process.env.E2E_TEST_SECRET) {
    headers["x-e2e-secret"] = process.env.E2E_TEST_SECRET;
  }
  return headers;
}

function testApiHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...browserExtraHeaders() };
}

function parseSetCookies(headers: Headers, baseUrl: string) {
  const domain = new URL(baseUrl).hostname;
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map((header) => {
    const [nameValue, ...parts] = header.split(";").map((s) => s.trim());
    const eq = nameValue.indexOf("=");
    const name = nameValue.slice(0, eq);
    const value = nameValue.slice(eq + 1);
    const attrs: Record<string, string> = {};
    for (const part of parts) {
      const pos = part.indexOf("=");
      const key = (pos === -1 ? part : part.slice(0, pos)).toLowerCase().trim();
      attrs[key] = pos === -1 ? "true" : part.slice(pos + 1).trim();
    }
    return {
      name,
      value,
      domain,
      path: attrs["path"] ?? "/",
      expires: attrs["max-age"]
        ? Math.floor(Date.now() / 1000) + parseInt(attrs["max-age"])
        : attrs["expires"]
          ? Math.floor(new Date(attrs["expires"]).getTime() / 1000)
          : -1,
      httpOnly: "httponly" in attrs,
      secure: "secure" in attrs,
      sameSite: (["Strict", "Lax", "None"].includes(attrs["samesite"] ?? "")
        ? attrs["samesite"]
        : "Lax") as "Strict" | "Lax" | "None",
    };
  });
}

async function createFreshAuthedContext(
  browser: Browser,
): Promise<{ ctx: BrowserContext; email: string }> {
  const email = `e2e+fresh-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const res = await fetch(`${BASE_URL}/api/test/auth`, {
    method: "POST",
    headers: testApiHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok)
    throw new Error(
      `Fresh auth setup failed: ${res.status} — is this a dev/preview environment?`,
    );

  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  });
  await ctx.addCookies(parseSetCookies(res.headers, BASE_URL));
  return { ctx, email };
}

export {
  BASE_URL,
  testApiHeaders,
  browserExtraHeaders,
  createFreshAuthedContext,
};
