import { expect, test } from "./fixtures";
import { createFreshAuthedContext } from "./helpers";

test.describe("nav user menu", () => {
  test("shows a fallback placeholder avatar for a user without a profile row", async ({
    browser,
  }) => {
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto("/gruppen");
      const trigger = page.getByRole("button", { name: "Menü öffnen" });
      await expect(trigger).toBeVisible();
      // No profile row yet — initials would be blank text, so the fallback
      // renders a "?" placeholder in the same styled circle.
      await expect(trigger).toContainText("?");
    } finally {
      await ctx.close();
    }
  });

  test("logout ends the session and redirects to /anmelden", async ({
    browser,
  }) => {
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto("/gruppen");
      await page.getByRole("button", { name: "Menü öffnen" }).click();

      const logoutItem = page.getByRole("menuitem", { name: "Abmelden" });
      await expect(logoutItem).toBeVisible();
      await logoutItem.click();

      await expect(page).toHaveURL(/\/anmelden/);

      // Session must actually be terminated server-side, not just a client nav.
      await page.goto("/gruppen");
      await expect(page).toHaveURL(/\/anmelden/);
    } finally {
      await ctx.close();
    }
  });
});
