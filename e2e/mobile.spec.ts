import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow } from "./helpers";

// Runs only in the `mobile` project (390px, see playwright.config.ts).
test.describe("mobile viewport (390px)", () => {
  test("public pages do not overflow horizontally", async ({ page }) => {
    for (const path of ["/", "/anmelden", "/impressum", "/datenschutz"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("groups overview and group detail do not overflow", async ({
    authedPage,
  }) => {
    expect(authedPage.viewportSize()?.width).toBe(390);
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage
      .locator("#name")
      .fill("Mobile Gruppe mit einem ziemlich langen Namen zum Testen");
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 15_000,
    });
    await expect(authedPage.locator("[data-invite-url]")).toBeVisible({
      timeout: 15_000,
    });
    await expectNoHorizontalOverflow(authedPage);

    await authedPage.goto("/gruppen");
    await expect(authedPage.locator("h1")).toBeVisible();
    await expect(authedPage.getByText("Mobile Gruppe").first()).toBeVisible();
    await expectNoHorizontalOverflow(authedPage);
  });
});
