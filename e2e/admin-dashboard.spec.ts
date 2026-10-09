import { config } from "dotenv";
import { type Page, expect, test } from "@playwright/test";
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

async function setupGroup(page: Page, groupName: string): Promise<string> {
  await page.goto("/gruppen/neu");
  await expect(page.locator("#name")).toBeVisible();
  if (await page.locator("#firstName").isVisible()) {
    await page.locator("#firstName").fill("Test");
    await page.locator("#lastName").fill("Admin");
  }
  await page.locator("#name").fill(groupName);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
    timeout: 15_000,
  });
  return page.url().split("/gruppen/")[1];
}

test("guest gets 404 on /admin/audit-log", async ({ browser }) => {
  const context = await browser.newContext(guestContextOptions());
  const page = await context.newPage();
  const response = await page.goto("/admin/audit-log");
  expect(response?.status()).toBe(404);
  await context.close();
});

test.describe("super admin dashboard and audit log", () => {
  test.skip(
    !SUPER_ADMIN_EMAIL,
    "SUPER_ADMIN_EMAIL not set in .env.local — skipping admin dashboard checks",
  );

  test("golden path: dashboard stats, recent activity, and full audit log", async ({
    browser,
  }) => {
    const groupName = `E2E Audit Gruppe ${Date.now()}`;

    const creatorContext = await browser.newContext(guestContextOptions());
    const creatorEmail = `e2e+audit-creator-${Date.now()}@test.local`;
    const creatorRes = await fetch(`${BASE_URL}/api/test/auth`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email: creatorEmail }),
    });
    if (!creatorRes.ok)
      throw new Error(`Creator auth setup failed: ${creatorRes.status}`);
    await creatorContext.addCookies(parseCookies(creatorRes));
    const creatorPage = await creatorContext.newPage();
    await setupGroup(creatorPage, groupName);
    await creatorContext.close();

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

    // Delete the group as super-admin so a `delete_group` audit row exists —
    // this also covers the "deleted target, no broken link" acceptance
    // criterion once it shows up in the audit log below.
    await page.goto("/admin/gruppen");
    const filterInput = page.getByPlaceholder("Nach Name oder Slug filtern…");
    await filterInput.fill(groupName);
    await page.getByRole("link", { name: groupName }).click();
    await expect(page).toHaveURL(/\/admin\/gruppen\/[^/]+$/);
    const groupId = page.url().split("/admin/gruppen/")[1];
    await page.getByRole("button", { name: "Gruppe löschen" }).click();
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page).toHaveURL(/\/admin\/gruppen$/);

    // Dashboard: stat cards + recent activity with a link to the full log.
    await page.goto("/admin");
    await expect(page.locator("h1")).toHaveText("Admin");
    await expect(page.getByText("Gruppen gesamt")).toBeVisible();
    await expect(page.getByText("Gruppe gelöscht").first()).toBeVisible();

    await page.getByRole("link", { name: "Alle anzeigen →" }).click();
    await expect(page).toHaveURL(/\/admin\/audit-log$/);

    // Full audit log: filter by action, verify deleted target has no link.
    await page.getByLabel("Nach Aktion filtern").selectOption("delete_group");
    const table = page.getByRole("table");
    const row = table.getByRole("row").filter({ hasText: groupId });
    await expect(row.getByText(groupId, { exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: groupId })).not.toBeVisible();

    await row.getByText("Details anzeigen").click();
    await expect(page.getByText(groupName)).toBeVisible();

    await context.close();
  });
});
