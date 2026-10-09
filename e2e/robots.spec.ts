import { expect, test } from "./fixtures";

test.describe("crawler access", () => {
  test("robots.txt is reachable and disallows all indexing", async ({
    page,
  }) => {
    const response = await page.goto("/robots.txt");
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain("Disallow: /");
  });

  test("unknown routes 404 instead of redirecting to /anmelden", async ({
    page,
  }) => {
    const response = await page.goto("/this-route-does-not-exist-xyz");
    expect(response?.status()).toBe(404);
    await expect(page).not.toHaveURL(/\/anmelden/);
  });

  test("bot user agents are blocked from the app", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: "Googlebot" });
    const page = await ctx.newPage();
    try {
      const response = await page.goto("/gruppen");
      expect(response?.status()).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
