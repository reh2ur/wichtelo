import { expect, test } from "./fixtures";
import { createFreshAuthedContext } from "./helpers";

test.describe("not-found pages return real 404", () => {
  test("unknown group slug returns 404 with German page", async ({
    authedPage,
  }) => {
    const response = await authedPage.goto("/gruppen/gibt-es-nicht-xyz");
    expect(response?.status()).toBe(404);
    await expect(authedPage.locator("h1")).toContainText(
      "Seite nicht gefunden",
    );
    await expect(
      authedPage.getByRole("link", { name: "Zur Startseite" }),
    ).toBeVisible();
  });

  test("unknown group settings slug returns 404", async ({ authedPage }) => {
    const response = await authedPage.goto(
      "/gruppen/gibt-es-nicht-xyz/einstellungen",
    );
    expect(response?.status()).toBe(404);
  });

  test("non-member gets 404 for existing group", async ({
    authedPage,
    browser,
  }) => {
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage.locator("#name").fill("Nur Mitglieder");
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 15_000,
    });
    const slug = authedPage.url().split("/gruppen/")[1];

    const { ctx } = await createFreshAuthedContext(browser);
    try {
      const page = await ctx.newPage();
      const response = await page.goto(`/gruppen/${slug}`);
      expect(response?.status()).toBe(404);
      await expect(page.locator("h1")).toContainText("Seite nicht gefunden");
    } finally {
      await ctx.close();
    }
  });
});
