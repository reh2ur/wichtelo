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

test("guest gets 404 on /admin/gruppen", async ({ browser }) => {
  const context = await browser.newContext(guestContextOptions());
  const page = await context.newPage();
  const response = await page.goto("/admin/gruppen");
  expect(response?.status()).toBe(404);
  await context.close();
});

test.describe("super admin group management", () => {
  test.skip(
    !SUPER_ADMIN_EMAIL,
    "SUPER_ADMIN_EMAIL not set in .env.local — skipping admin groups checks",
  );

  test("golden path: list, view, and delete a group", async ({ browser }) => {
    const groupName = `E2E Admin Gruppe ${Date.now()}`;

    const creatorContext = await browser.newContext(guestContextOptions());
    const creatorEmail = `e2e+admin-group-creator-${Date.now()}@test.local`;
    const creatorRes = await fetch(`${BASE_URL}/api/test/auth`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email: creatorEmail }),
    });
    if (!creatorRes.ok)
      throw new Error(`Creator auth setup failed: ${creatorRes.status}`);
    await creatorContext.addCookies(parseCookies(creatorRes));
    const creatorPage = await creatorContext.newPage();
    const slug = await setupGroup(creatorPage, groupName);
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

    await page.goto("/admin/gruppen");
    await expect(page.locator("h1")).toBeVisible();

    const filterInput = page.getByPlaceholder("Nach Name oder Slug filtern…");
    await filterInput.fill(groupName);

    const groupLink = page.getByRole("link", { name: groupName });
    await expect(groupLink).toBeVisible();

    // Filtering by the German state label (not the raw "open"/"drawn" enum) must also match.
    await filterInput.fill("Offen");
    await expect(groupLink).toBeVisible();

    await filterInput.fill(groupName);
    await groupLink.click();

    await expect(page).toHaveURL(/\/admin\/gruppen\/[^/]+$/);
    await expect(page.getByText(slug).first()).toBeVisible();
    await expect(page.getByText("Offen").first()).toBeVisible();

    await page.getByRole("button", { name: "Gruppe löschen" }).click();
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page).toHaveURL(/\/admin\/gruppen$/);

    await context.close();
  });
});
