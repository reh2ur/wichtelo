import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { e2eWorkerEmail } from "../lib/e2e-run";
import {
  BASE_URL,
  RUN_ID,
  testApiHeaders,
  browserExtraHeaders,
  projectDeviceOptions,
} from "./helpers";

// Parses Set-Cookie response headers into Playwright's addCookies() format.
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

interface WorkerFixtures {
  authedContext: BrowserContext;
  workerEmail: string;
}
interface TestFixtures {
  authedPage: Page;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Run id + worker index, not the PID: fresh CI runners reuse similar PIDs and
  // parallel runs share one staging DB.
  workerEmail: [
    async ({}, use, workerInfo) => {
      await use(e2eWorkerEmail(RUN_ID, workerInfo.workerIndex));
    },
    { scope: "worker" },
  ],

  // Runs once per worker process — all tests in that worker share the session.
  authedContext: [
    async ({ browser, workerEmail: email }, use, workerInfo) => {
      // Single request: creates user, verifies OTP, returns session as Set-Cookie headers.
      const res = await fetch(`${BASE_URL}/api/test/auth`, {
        method: "POST",
        headers: testApiHeaders(),
        body: JSON.stringify({ email }),
      });
      if (!res.ok)
        throw new Error(
          `Auth fixture setup failed: ${res.status} — is this a dev/preview environment?`,
        );

      const context = await browser.newContext({
        ...projectDeviceOptions(workerInfo.project.use),
        baseURL: BASE_URL,
        ignoreHTTPSErrors: BASE_URL.includes("localhost"),
        extraHTTPHeaders: browserExtraHeaders(),
      });

      // Inject session cookies directly — no browser navigation required.
      await context.addCookies(parseSetCookies(res.headers, BASE_URL));

      await use(context);

      // Cleanup: remove the worker's test user and any groups it created.
      await fetch(`${BASE_URL}/api/test/session`, {
        method: "DELETE",
        headers: testApiHeaders(),
        body: JSON.stringify({ email }),
      }).catch(() => {});
      await context.close();
    },
    { scope: "worker" },
  ],

  // Each test gets its own page from the shared authenticated context.
  authedPage: async ({ authedContext, workerEmail }, provide) => {
    const page = await authedContext.newPage();
    await provide(page);
    await page.close();

    // create_group caps a user at 5 groups / 24 h. The worker user is shared by
    // every test, so drop its groups after each one (tests never share groups).
    await fetch(`${BASE_URL}/api/test/session`, {
      method: "DELETE",
      headers: testApiHeaders(),
      body: JSON.stringify({ email: workerEmail, groupsOnly: true }),
    }).catch(() => {});
  },
});

export { expect } from "@playwright/test";
