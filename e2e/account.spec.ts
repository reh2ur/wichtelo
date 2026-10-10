import { test, expect } from "./fixtures";
import {
  BASE_URL,
  testApiHeaders,
  createFreshAuthedContext,
  browserExtraHeaders,
} from "./helpers";

async function getDeletionToken(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/test/deletion-token`, {
    method: "POST",
    headers: testApiHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`getDeletionToken failed: ${res.status}`);
  const { token } = await res.json();
  return token as string;
}

test.describe("account page access", () => {
  test("unauthenticated → redirect to /anmelden", async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: BASE_URL.includes("localhost"),
      extraHTTPHeaders: browserExtraHeaders(),
    });
    const page = await ctx.newPage();
    await page.goto("/konto");
    await expect(page).toHaveURL(/\/anmelden/);
    await ctx.close();
  });

  test("authenticated user can view /konto", async ({ authedPage }) => {
    await authedPage.goto("/konto");
    await expect(authedPage.locator("h1")).toBeVisible();
    await expect(authedPage.locator("h1")).toContainText("Konto");
    await authedPage.waitForLoadState("domcontentloaded");
  });
});

test.describe("profile update", () => {
  test("shows profile fields and can update name", async ({ authedPage }) => {
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Erika");
      await authedPage.locator("#lastName").fill("Musterfrau");
      await authedPage.locator("#name").fill("Testgruppe Konto");
      await authedPage.locator('button[type="submit"]').click();
      await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/);
    }

    await authedPage.goto("/konto");
    await expect(authedPage.locator("#firstName")).toBeVisible();

    expect(await authedPage.locator("#firstName").inputValue()).toBeTruthy();

    await authedPage.locator("#firstName").fill("Erika");
    await authedPage.locator("#lastName").fill("Geändert");
    await authedPage.locator('button[type="submit"]').first().click();

    await expect(authedPage.locator('text="Gespeichert."')).toBeVisible({
      timeout: 5000,
    });
  });

  test("email field is disabled (not editable)", async ({ authedPage }) => {
    await authedPage.goto("/konto");
    await expect(authedPage.locator("#firstName")).toBeVisible();
    const emailInput = authedPage.locator("#email-display");
    await expect(emailInput).toBeDisabled();
  });

  test("shows error when name fields empty", async ({ authedPage }) => {
    await authedPage.goto("/konto");
    await expect(authedPage.locator("#firstName")).toBeVisible();
    await authedPage.locator("#firstName").fill("");
    await authedPage.locator("#lastName").fill("");
    await authedPage.locator('button[type="submit"]').first().click();
    await expect(
      authedPage.locator('text="Bitte gib Vor- und Nachnamen ein."'),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("account deletion flow", () => {
  test("deletion confirmation UI shows and sends email", async ({
    browser,
  }) => {
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();

    await page.goto("/gruppen/neu");
    await expect(page.locator("#name")).toBeVisible();
    if (await page.locator("#firstName").isVisible()) {
      await page.locator("#firstName").fill("Test");
      await page.locator("#lastName").fill("Deletion");
      await page.locator("#name").fill("Deletion Test Gruppe");
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/);
    }

    await page.goto("/konto");
    await expect(
      page.locator('button:has-text("Konto löschen")'),
    ).toBeVisible();
    await page.locator('button:has-text("Konto löschen")').click();

    await expect(
      page.locator('button:has-text("Bestätigungs-E-Mail senden")'),
    ).toBeVisible();
    await expect(page.locator('button:has-text("Abbrechen")')).toBeVisible();

    await page.locator('button:has-text("Abbrechen")').click();
    await expect(
      page.locator('button:has-text("Konto löschen")'),
    ).toBeVisible();

    await ctx.close();
  });

  test("deletion confirm link only deletes after button click", async ({
    browser,
  }) => {
    const email = `e2e+deletion-${Date.now()}@test.local`;

    const res = await fetch(`${BASE_URL}/api/test/auth`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(`Auth setup failed: ${res.status}`);

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: BASE_URL.includes("localhost"),
      extraHTTPHeaders: browserExtraHeaders(),
    });

    const raw = res.headers.getSetCookie?.() ?? [];
    const domain = new URL(BASE_URL).hostname;
    const cookies = raw.map((header) => {
      const [nameValue, ...parts] = header.split(";").map((s) => s.trim());
      const eq = nameValue.indexOf("=");
      const name = nameValue.slice(0, eq);
      const value = nameValue.slice(eq + 1);
      const attrs: Record<string, string> = {};
      for (const part of parts) {
        const pos = part.indexOf("=");
        const key = (pos === -1 ? part : part.slice(0, pos))
          .toLowerCase()
          .trim();
        attrs[key] = pos === -1 ? "true" : part.slice(pos + 1).trim();
      }
      return {
        name,
        value,
        domain,
        path: attrs["path"] ?? "/",
        expires: attrs["max-age"]
          ? Math.floor(Date.now() / 1000) + parseInt(attrs["max-age"])
          : -1,
        httpOnly: "httponly" in attrs,
        secure: "secure" in attrs,
        sameSite: (["Strict", "Lax", "None"].includes(attrs["samesite"] ?? "")
          ? attrs["samesite"]
          : "Lax") as "Strict" | "Lax" | "None",
      };
    });
    await ctx.addCookies(cookies);

    const token = await getDeletionToken(email);
    const page = await ctx.newPage();
    await page.goto(`/konto/delete/confirm?token=${token}`);

    // GET must not delete: confirmation page with a button is shown.
    const confirmButton = page.locator(
      'button:has-text("Konto endgültig löschen")',
    );
    await expect(confirmButton).toBeVisible();
    await page.goto("/konto");
    await expect(page.locator("h1")).toContainText("Konto");
    await page.goto(`/konto/delete/confirm?token=${token}`);
    await confirmButton.click();

    await expect(page).toHaveURL(/\/\?deleted=1$/, {
      timeout: 10_000,
    });

    await ctx.close();
  });

  test("deletion confirm link works logged out and is single-use", async ({
    browser,
  }) => {
    const email = `e2e+deletion-out-${Date.now()}@test.local`;
    const res = await fetch(`${BASE_URL}/api/test/auth`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(`Auth setup failed: ${res.status}`);
    const token = await getDeletionToken(email);

    // Fresh context: no session cookies.
    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    });
    const page = await ctx.newPage();
    await page.goto(`/konto/delete/confirm?token=${token}`);
    await expect(page).toHaveURL(/\/konto\/delete\/confirm/);
    await page.locator('button:has-text("Konto endgültig löschen")').click();
    await expect(page).toHaveURL(/\/\?deleted=1$/, { timeout: 10_000 });

    // Token is dead after use.
    await page.goto(`/konto/delete/confirm?token=${token}`);
    await expect(page.locator("h1")).toContainText("Link ungültig");
    await ctx.close();
  });

  test("invalid deletion token shows invalid-link page", async ({
    authedPage,
  }) => {
    await authedPage.goto("/konto/delete/confirm?token=invalid-token");
    await expect(authedPage.locator("h1")).toContainText("Link ungültig");
    await expect(
      authedPage.locator('button:has-text("Konto endgültig löschen")'),
    ).toHaveCount(0);
  });
});
