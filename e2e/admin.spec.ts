import { config } from "dotenv";
import { expect, test } from "@playwright/test";
import { BASE_URL, testApiHeaders, browserExtraHeaders } from "./helpers";

// Server picks up SUPER_ADMIN_EMAIL from .env.local (Next's own dotenv loading);
// mirror that here so this spec knows which identity to authenticate as.
config({ path: ".env.local", quiet: true });

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;

function parseCookies(res: Response) {
  return (res.headers.getSetCookie?.() ?? []).map((header) => {
    const [nameValue] = header.split(";");
    const eq = nameValue.indexOf("=");
    return {
      name: nameValue.slice(0, eq),
      value: nameValue.slice(eq + 1),
      domain: new URL(BASE_URL).hostname,
      path: "/",
    };
  });
}

function guestContextOptions() {
  return {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  };
}

test("guest gets 404 on /admin", async ({ browser }) => {
  const context = await browser.newContext(guestContextOptions());
  const page = await context.newPage();
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await context.close();
});

test("authenticated non-admin gets 404 on /admin", async ({ browser }) => {
  const email = `e2e+non-admin-${Date.now()}@test.local`;
  const res = await fetch(`${BASE_URL}/api/test/auth`, {
    method: "POST",
    headers: testApiHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Auth fixture setup failed: ${res.status}`);

  const context = await browser.newContext(guestContextOptions());
  await context.addCookies(parseCookies(res));
  const page = await context.newPage();
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);

  await fetch(`${BASE_URL}/api/test/session`, {
    method: "DELETE",
    headers: testApiHeaders(),
    body: JSON.stringify({ email }),
  }).catch(() => {});
  await context.close();
});

test("super admin gets 200 on /admin", async ({ browser }) => {
  test.skip(
    !SUPER_ADMIN_EMAIL,
    "SUPER_ADMIN_EMAIL not set in .env.local — skipping admin-access check",
  );
  const res = await fetch(`${BASE_URL}/api/test/auth`, {
    method: "POST",
    headers: testApiHeaders(),
    body: JSON.stringify({ email: SUPER_ADMIN_EMAIL }),
  });
  if (!res.ok) throw new Error(`Auth fixture setup failed: ${res.status}`);

  const context = await browser.newContext(guestContextOptions());
  await context.addCookies(parseCookies(res));
  const page = await context.newPage();
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveText("Admin");

  await context.close();
});
