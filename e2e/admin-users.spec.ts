import { config } from "dotenv";
import { expect, test } from "@playwright/test";
import { BASE_URL, testApiHeaders, browserExtraHeaders } from "./helpers";

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

test("guest gets 404 on /admin/benutzer", async ({ browser }) => {
  const context = await browser.newContext(guestContextOptions());
  const page = await context.newPage();
  const response = await page.goto("/admin/benutzer");
  expect(response?.status()).toBe(404);
  await context.close();
});

test.describe("super admin user management", () => {
  test.skip(
    !SUPER_ADMIN_EMAIL,
    "SUPER_ADMIN_EMAIL not set in .env.local — skipping admin users checks",
  );

  test("golden path: list, view, ban, unban, delete a user", async ({
    browser,
  }) => {
    const targetEmail = `e2e+admin-target-${Date.now()}@test.local`;

    const targetRes = await fetch(`${BASE_URL}/api/test/auth`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email: targetEmail }),
    });
    if (!targetRes.ok)
      throw new Error(`Target user setup failed: ${targetRes.status}`);

    const adminRes = await fetch(`${BASE_URL}/api/test/auth`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email: SUPER_ADMIN_EMAIL }),
    });
    if (!adminRes.ok)
      throw new Error(`Admin auth setup failed: ${adminRes.status}`);

    const context = await browser.newContext(guestContextOptions());
    await context.addCookies(parseCookies(adminRes));
    const page = await context.newPage();

    await page.goto("/admin/benutzer");
    await expect(page.locator("h1")).toBeVisible();

    const filterInput = page.getByPlaceholder("Nach E-Mail oder Name filtern…");
    await filterInput.fill(targetEmail);

    const targetLink = page.getByRole("link", { name: targetEmail });
    await expect(targetLink).toBeVisible();
    await targetLink.click();

    await expect(page).toHaveURL(/\/admin\/benutzer\/[^/]+$/);
    await expect(page.getByText("Aktiv").first()).toBeVisible();

    await page.getByRole("button", { name: "Sperren" }).click();
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByText("Gesperrt").first()).toBeVisible();

    await page.getByRole("button", { name: "Entsperren" }).click();
    await expect(page.getByText("Aktiv").first()).toBeVisible();

    await page.getByRole("button", { name: "Benutzer löschen" }).click();
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page).toHaveURL(/\/admin\/benutzer$/);

    await context.close();
  });
});
