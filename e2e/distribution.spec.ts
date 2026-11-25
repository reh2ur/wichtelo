import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  BASE_URL,
  browserExtraHeaders,
  expectNoHorizontalOverflow,
} from "./helpers";

function guestContextOptions() {
  return {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  };
}

async function setupGroup(authedPage: Page, groupName: string) {
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
  const inviteBtn = authedPage.locator("[data-invite-url]");
  await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
  return {
    slug: authedPage.url().split("/gruppen/")[1],
    inviteUrl: (await inviteBtn.getAttribute("data-invite-url"))!,
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
  await expect(page.locator("h1")).toBeVisible();
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

/** Admin + Bernd Becker + Clara Conrad, drawn. Returns Bernd's page too. */
async function drawnGroup(authedPage: Page, browser: Browser, name: string) {
  const { slug, inviteUrl } = await setupGroup(authedPage, name);
  const ctxB = await browser.newContext(guestContextOptions());
  const ctxC = await browser.newContext(guestContextOptions());
  const stamp = Date.now();
  const pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
    firstName: "Bernd",
    lastName: "Becker",
    email: `e2e+dist-b-${stamp}@example.com`,
  });
  await joinViaInvite(ctxC, inviteUrl, slug, {
    firstName: "Clara",
    lastName: "Conrad",
    email: `e2e+dist-c-${stamp}@example.com`,
  });
  await authedPage.goto(`/gruppen/${slug}`);
  await authedPage.locator('button:has-text("Auslosung starten")').click();
  await authedPage.locator('button:has-text("Jetzt auslosen")').click();
  await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible({
    timeout: 15_000,
  });
  return {
    slug,
    pageB,
    close: () => Promise.all([ctxB.close(), ctxC.close()]),
  };
}

test.describe("admin distribution view", () => {
  test("not drawn yet: shows a hint instead of the graph", async ({
    authedPage,
  }) => {
    const { slug } = await setupGroup(authedPage, "Verteilung offen");
    await authedPage.goto(`/gruppen/${slug}/verteilung`);
    await expect(
      authedPage.getByText("Die Gruppe wurde noch nicht ausgelost"),
    ).toBeVisible();
    await expect(authedPage.getByTestId("distribution-checks")).toHaveCount(0);
  });

  test("pseudonymised graph, checks, delayed reveal with cancel, mobile layout", async ({
    authedPage,
    browser,
  }) => {
    const { slug, pageB, close } = await drawnGroup(
      authedPage,
      browser,
      "Verteilung Goldenpath",
    );
    try {
      // Entry point on the group page.
      await authedPage.getByRole("link", { name: /Verteilung prüfen/ }).click();
      await expect(authedPage).toHaveURL(
        new RegExp(`/gruppen/${slug}/verteilung$`),
      );

      // Checks pass for a fresh draw.
      await expect(
        authedPage.getByTestId("distribution-checks"),
      ).toHaveAttribute("data-ok", "true");
      await expect(authedPage.getByTestId("check-noMutual")).toHaveAttribute(
        "data-ok",
        "true",
      );

      // Three people in each column, one arrow per giver, no real names yet
      // (only the admin's own node).
      const arrows = authedPage.getByTestId("distribution-arrows");
      await expect(arrows.locator('[data-testid^="person-left-"]')).toHaveCount(
        3,
      );
      await expect(
        arrows.locator('[data-testid^="person-right-"]'),
      ).toHaveCount(3);
      await expect(arrows.locator('path[data-testid^="arrow-"]')).toHaveCount(
        3,
      );
      await expect(arrows).not.toContainText("Bernd");
      await expect(arrows).not.toContainText("Clara");
      await expect(arrows).toContainText("(du)");

      // Reveal: first click starts the countdown, second click cancels it.
      const eye = arrows.locator('[data-testid^="reveal-left-"]').first();
      const label = (await eye.getAttribute("data-testid"))!.replace(
        "reveal-left-",
        "",
      );
      const left = authedPage.getByTestId(`person-left-${label}`);
      const right = authedPage.getByTestId(`person-right-${label}`);

      await eye.click();
      await expect(left).toHaveAttribute("data-state", "arming");
      await expect(authedPage.getByTestId("reveal-status")).toContainText(
        "in 3 Sekunden aufgedeckt",
      );
      await eye.click();
      await expect(left).toHaveAttribute("data-state", "hidden");
      await expect(authedPage.getByTestId("reveal-status")).toContainText(
        "abgebrochen",
      );
      // Past the original delay: still hidden, nothing was revealed.
      await authedPage.waitForTimeout(3500);
      await expect(left).toHaveAttribute("data-state", "hidden");
      await expect(left).toContainText(`Person ${label}`);

      // Reveal for real: name appears in both columns, then hide again.
      await eye.click();
      await expect(left).toHaveAttribute("data-state", "shown", {
        timeout: 10_000,
      });
      await expect(left).toContainText(/Bernd Becker|Clara Conrad/);
      await expect(right).toContainText(/Bernd Becker|Clara Conrad/);
      await eye.click();
      await expect(left).toHaveAttribute("data-state", "hidden");
      await expect(right).toContainText(`Person ${label}`);

      // List view mirrors the same state and is the mobile/a11y fallback.
      await authedPage.getByRole("button", { name: "Liste" }).click();
      await expect(
        authedPage.getByTestId("distribution-list").getByRole("listitem"),
      ).toHaveCount(3);

      // Mobile: no horizontal overflow in either view.
      await authedPage.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(authedPage);
      await authedPage.getByRole("button", { name: "Pfeile" }).click();
      await expect(authedPage.getByTestId("distribution-arrows")).toBeVisible();
      await expectNoHorizontalOverflow(authedPage);

      // Participants cannot open the page: same real 404 as an unknown group.
      const res = await pageB.goto(`/gruppen/${slug}/verteilung`);
      expect(res?.status()).toBe(404);
    } finally {
      await close();
    }
  });
});
