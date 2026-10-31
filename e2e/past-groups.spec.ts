import { type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  BASE_URL,
  browserExtraHeaders,
  expectNoHorizontalOverflow,
  projectDeviceOptions,
} from "./helpers";

function guestContextOptions(use: Parameters<typeof projectDeviceOptions>[0]) {
  return {
    ...projectDeviceOptions(use),
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  };
}

async function joinViaInvite(
  ctx: BrowserContext,
  inviteUrl: string,
  slug: string,
  opts: { firstName: string; lastName: string; email: string },
): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(inviteUrl);
  await page.locator("#email").fill(opts.email);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#otp")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeEnabled({
    timeout: 10_000,
  });
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#firstName")).toBeVisible({ timeout: 10_000 });
  await page.locator("#firstName").fill(opts.firstName);
  await page.locator("#lastName").fill(opts.lastName);
  await page.locator('button:has-text("Beitreten")').click();
  await expect(page).toHaveURL(new RegExp(`/gruppen/${slug}`), {
    timeout: 15_000,
  });
  return page;
}

/** Receiver names listed in the "Vergangene Gruppen" section for `groupName`. */
async function gaveToLines(page: Page, groupName: string) {
  await page.goto("/gruppen");
  const summary = page.locator("details.group > summary");
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await summary.click();
  const row = page.locator("details.group a", { hasText: groupName });
  await expect(row).toBeVisible();
  return row.getByText(/^Du hast .+ beschenkt$/).allTextContents();
}

// PRD story 18: "Vergangene Gruppen" shows who I gave to.
test.describe("past groups show own recipient (story 18)", () => {
  test("drawn past-year group lists only my own, abbreviated recipient", async ({
    authedPage,
    browser,
  }, testInfo) => {
    const pastYear = new Date().getFullYear() - 1;
    const groupName = `Vergangen ${Date.now()}`;

    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage.locator("#name").fill(groupName);
    await authedPage.locator("#year").selectOption(String(pastYear));
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 15_000,
    });
    const inviteBtn = authedPage.locator("[data-invite-url]");
    await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
    const inviteUrl = (await inviteBtn.getAttribute("data-invite-url"))!;
    const slug = authedPage.url().split("/gruppen/")[1];

    // Two members share a first name -> last names abbreviated ("Anna B.").
    const ctxB = await browser.newContext(
      guestContextOptions(testInfo.project.use),
    );
    const ctxC = await browser.newContext(
      guestContextOptions(testInfo.project.use),
    );
    const stamp = Date.now();
    try {
      const pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Anna",
        lastName: "Becker",
        email: `e2e+past-b-${stamp}@example.com`,
      });
      const pageC = await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Anna",
        lastName: "Conrad",
        email: `e2e+past-c-${stamp}@example.com`,
      });

      await authedPage.goto(`/gruppen/${slug}`);
      await authedPage.locator('button:has-text("Auslosung starten")').click();
      await authedPage.locator('button:has-text("Jetzt auslosen")').click();
      await expect(
        authedPage.locator("text=Zuweisung nachschlagen"),
      ).toBeVisible({ timeout: 15_000 });

      if (testInfo.project.name === "mobile") {
        // Drawn-group detail view (admin oracle + assignment) at 390px.
        await expectNoHorizontalOverflow(authedPage);
        await pageB.reload();
        await expect(pageB.locator("text=Du beschenkst")).toBeVisible();
        await expectNoHorizontalOverflow(pageB);
      }

      const names = ["Test", "Anna B.", "Anna C."];
      const own = ["Test", "Anna B.", "Anna C."];
      const seen: string[] = [];
      for (const [i, page] of [authedPage, pageB, pageC].entries()) {
        const lines = await gaveToLines(page, groupName);
        // Own row only: exactly one recipient line for this group.
        expect(lines).toHaveLength(1);
        const receiver = lines[0]
          .replace(/^Du hast /, "")
          .replace(/ beschenkt$/, "");
        expect(names).toContain(receiver);
        expect(receiver).not.toBe(own[i]);
        seen.push(receiver);
        if (testInfo.project.name === "mobile") {
          await expectNoHorizontalOverflow(page);
        }
      }
      // A draw is a permutation: every member is someone's recipient once.
      expect([...seen].sort()).toEqual([...names].sort());
    } finally {
      await ctxB.close();
      await ctxC.close();
    }
  });

  test("open past-year group shows no recipient line", async ({
    authedPage,
  }) => {
    const pastYear = new Date().getFullYear() - 1;
    const groupName = `Offen ${Date.now()}`;
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage.locator("#name").fill(groupName);
    await authedPage.locator("#year").selectOption(String(pastYear));
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 15_000,
    });
    await authedPage.goto("/gruppen");
    await expect(authedPage.getByText(groupName)).toBeVisible();
    await expect(authedPage.getByText(/^Du hast .+ beschenkt$/)).toHaveCount(0);
  });
});
