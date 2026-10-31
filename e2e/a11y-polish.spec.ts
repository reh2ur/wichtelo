import { expect, test } from "./fixtures";

test.describe("page titles (WCAG 2.4.2)", () => {
  test("public routes have distinct titles", async ({ page }) => {
    const seen = new Map<string, string>();
    for (const [path, title] of [
      ["/anmelden", "Anmelden – Wichtelo"],
      ["/impressum", "Impressum – Wichtelo"],
      ["/datenschutz", "Datenschutzerklärung – Wichtelo"],
    ] as const) {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      seen.set(title, path);
    }
    expect(seen.size).toBe(3);
  });

  test("authed routes have route-specific titles", async ({ authedPage }) => {
    await authedPage.goto("/gruppen");
    await expect(authedPage).toHaveTitle("Meine Gruppen – Wichtelo");
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage).toHaveTitle("Neue Gruppe – Wichtelo");
    await authedPage.goto("/konto");
    await expect(authedPage).toHaveTitle("Mein Konto – Wichtelo");
  });
});

test.describe("long group names", () => {
  test("100-char unbroken name does not clip at 360px", async ({
    authedPage,
  }) => {
    await authedPage.setViewportSize({ width: 360, height: 800 });
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage.locator("#name").fill("W".repeat(100));
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 15_000,
    });
    const h1 = authedPage.getByRole("heading", { level: 1, name: /^W+$/ });
    await expect(h1).toBeVisible();
    for (const path of [authedPage.url(), "/gruppen"]) {
      await authedPage.goto(path);
      const clipped = await authedPage.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(clipped).toBe(false);
    }
  });
});

test.describe("form controls", () => {
  test("inputs are at least 16px under md", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/anmelden");
    const size = await page
      .locator("#email")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});
