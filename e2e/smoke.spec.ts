import { expect, test } from "@playwright/test";

test("landing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  // Icons are SVG (Phosphor), never raw emoji/dingbat glyphs (#146)
  expect(await page.locator("h1").innerText()).not.toMatch(
    /[\u2600-\u27BF]|\p{Extended_Pictographic}/u,
  );
});

test("unknown route shows branded German 404 with HTTP 404", async ({
  page,
}) => {
  const res = await page.goto("/diese-seite-gibt-es-nicht");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toContainText("Seite nicht gefunden");
  await expect(
    page.getByRole("link", { name: "Zur Startseite" }),
  ).toBeVisible();
});
