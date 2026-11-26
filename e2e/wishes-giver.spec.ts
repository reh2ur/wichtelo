import { type Page } from "@playwright/test";
import { type BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BASE_URL, browserExtraHeaders } from "./helpers";

function guestContextOptions() {
  return {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  };
}

async function setupGroup(
  authedPage: Page,
  groupName: string,
): Promise<{ slug: string; inviteUrl: string }> {
  await authedPage.goto("/gruppen/neu");
  await expect(authedPage.locator("#name")).toBeVisible();
  if (await authedPage.locator("#firstName").isVisible()) {
    await authedPage.locator("#firstName").fill("Test");
    await authedPage.locator("#lastName").fill("Admin");
  }
  await authedPage.locator("#name").fill(groupName);
  await authedPage.locator('button[type="submit"]').click();
  await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
    timeout: 15_000,
  });
  await authedPage.waitForLoadState("domcontentloaded");
  const inviteBtn = authedPage.locator("[data-invite-url]");
  await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
  const inviteUrl = await inviteBtn.getAttribute("data-invite-url");
  const slug = authedPage.url().split("/gruppen/")[1];
  return { slug, inviteUrl: inviteUrl! };
}

async function joinViaInvite(
  ctx: BrowserContext,
  inviteUrl: string,
  slug: string,
  opts: { firstName: string; lastName: string; email: string },
): Promise<Page> {
  const page = await ctx.newPage();

  await page.goto(inviteUrl);
  await expect(page.locator("h1")).toBeVisible();

  // Auth step: email only
  await page.locator("#email").fill(opts.email);
  await page.locator('button[type="submit"]').click();

  // OTP phase — dev mode auto-fills devOtp into input
  await expect(page.locator("#otp")).toBeVisible();
  // Wait until the submit button is enabled (OTP pre-filled = 6 chars)
  await expect(page.locator('button[type="submit"]')).toBeEnabled({
    timeout: 10_000,
  });
  await page.locator('button[type="submit"]').click();

  // After OTP, redirected back to invite URL → accept form with name fields
  await expect(page.locator("#firstName")).toBeVisible({ timeout: 10_000 });
  await page.locator("#firstName").fill(opts.firstName);
  await page.locator("#lastName").fill(opts.lastName);
  await page.locator('button:has-text("Beitreten")').click();

  await expect(page).toHaveURL(new RegExp(`/gruppen/${slug}`), {
    timeout: 15_000,
  });

  return page;
}

/** Quick-add a wish, then link it to the user's (only) group. */
async function addGroupWish(page: Page, title: string, note: string) {
  await page.goto("/wuensche");
  const quick = page.getByTestId("wish-quick-add");
  await expect(quick.getByRole("button")).toBeEnabled();
  await quick.getByLabel("Neuer Wunsch").fill(title);
  await quick.getByRole("button", { name: "Hinzufügen" }).click();
  const form = page.getByTestId("wish-edit-form");
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Speichern" })).toBeEnabled();
  await form.getByLabel("Notiz").fill(note);
  await form.getByLabel("Link").fill("example.com/geschenk");
  await form.getByLabel("Ungefährer Preis in €").fill("12");
  // index 0 = "Keiner Gruppe zugeordnet", index 1 = the only group
  await form.getByLabel("Gruppe").selectOption({ index: 1 });
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(page).toHaveURL(/\/wuensche$/);
}

test.describe("wishes: giver visibility (#209)", () => {
  test("only the giver sees the recipient's wish, after reveal", async ({
    authedPage,
    browser,
  }) => {
    // Three OTP sign-ins, three wishes, a draw and three reveals.
    test.setTimeout(120_000);
    const { slug, inviteUrl } = await setupGroup(authedPage, "Wunsch Sichtbar");
    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());
    const stamp = Date.now();

    try {
      const pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+wg-b-${stamp}@example.com`,
      });
      const pageC = await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+wg-c-${stamp}@example.com`,
      });

      await addGroupWish(authedPage, "Wunsch-Admin", "Notiz-Admin");
      await addGroupWish(pageB, "Wunsch-Bernd", "Notiz-Bernd");
      await addGroupWish(pageC, "Wunsch-Clara", "Notiz-Clara");

      // Owner-side hint, no giver identity.
      await expect(pageB.getByTestId("wishes-giver-hint")).toContainText(
        "die Person, die dich beschenkt",
      );

      // Before the draw nobody sees anyone else's wish.
      await pageB.goto(`/gruppen/${slug}`);
      await expect(pageB.getByTestId("recipient-wishes")).toHaveCount(0);

      await authedPage.goto(`/gruppen/${slug}`);
      await authedPage.locator('button:has-text("Auslosung starten")').click();
      await authedPage.locator('button:has-text("Jetzt auslosen")').click();
      await expect(
        authedPage.locator("text=Zuweisung nachschlagen"),
      ).toBeVisible({ timeout: 15_000 });

      const own: [Page, string][] = [
        [authedPage, "Wunsch-Admin"],
        [pageB, "Wunsch-Bernd"],
        [pageC, "Wunsch-Clara"],
      ];
      const seen: string[] = [];
      for (const [page, ownTitle] of own) {
        await page.goto(`/gruppen/${slug}`);
        // Hidden until the reveal tap, like the name.
        await expect(page.getByTestId("assignment-masked")).toBeVisible();
        await expect(page.getByTestId("recipient-wishes")).toHaveCount(0);
        await page.getByTestId("assignment-toggle").click();

        const list = page.getByTestId("recipient-wishes");
        await expect(list).toBeVisible();
        // Exactly the recipient's wish: never own, never a third person's.
        const items = list.getByTestId("recipient-wish");
        await expect(items).toHaveCount(1);
        await expect(items.first()).not.toContainText(ownTitle);
        await expect(items.first()).toContainText("ca. 12,00");
        const link = items.first().getByRole("link", { name: /example\.com/ });
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        seen.push((await items.first().innerText()).split("\n")[0]);

        // Hides again together with the name.
        await page.getByTestId("assignment-toggle").click();
        await expect(page.getByTestId("recipient-wishes")).toHaveCount(0);
      }
      // 3-cycle: each wish is seen by exactly one giver.
      expect(new Set(seen).size).toBe(3);
    } finally {
      await ctxB.close();
      await ctxC.close();
    }
  });
});
