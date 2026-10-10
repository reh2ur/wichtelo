import { type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  BASE_URL,
  browserExtraHeaders,
  createFreshAuthedContext,
} from "./helpers";

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
  year?: number,
): Promise<{ slug: string; inviteUrl: string }> {
  await authedPage.goto("/gruppen/neu");
  await expect(authedPage.locator("#name")).toBeVisible();
  if (await authedPage.locator("#firstName").isVisible()) {
    await authedPage.locator("#firstName").fill("Test");
    await authedPage.locator("#lastName").fill("Admin");
  }
  await authedPage.locator("#name").fill(groupName);
  if (year !== undefined) {
    await authedPage.locator("#year").selectOption(String(year));
  }
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

test.describe("group overview", () => {
  test("group with a future year is listed as active", async ({
    authedPage,
  }) => {
    const name = `Zukunft ${Date.now()}`;
    const nextYear = new Date().getFullYear() + 1;
    await setupGroup(authedPage, name, nextYear);

    await authedPage.goto("/gruppen");
    const link = authedPage.locator(`a:has-text("${name}")`);
    await expect(link).toBeVisible();
    // Not inside the collapsed "Vergangene Gruppen" section.
    await expect(
      authedPage.locator("details a", { hasText: name }),
    ).toHaveCount(0);
  });

  test("group named Neu gets a reachable slug", async ({ authedPage }) => {
    const { slug } = await setupGroup(authedPage, "Neu");
    expect(slug).toMatch(/^neu-gruppe/);
    await expect(
      authedPage.getByRole("heading", { name: "Neu", exact: true }),
    ).toBeVisible();
    // Not the create form. cacheComponents keeps the previous route (the
    // create form) mounted but hidden after the client-side redirect, so
    // check visibility, not DOM presence.
    await expect(authedPage.locator("#name")).toBeHidden();
  });
});

test.describe("group routing", () => {
  test("open group: participant sees waiting notice; drawn group invite redirects member to group page", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      `Routing ${Date.now()}`,
    );
    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());
    try {
      const pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+routing-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+routing-c-${Date.now()}@example.com`,
      });

      await pageB.reload();
      await expect(
        pageB.locator("text=Die Auslosung steht noch aus"),
      ).toBeVisible({ timeout: 10_000 });

      await authedPage.goto(`/gruppen/${slug}`);
      await authedPage.locator('button:has-text("Auslosung starten")').click();
      await authedPage.locator('button:has-text("Jetzt auslosen")').click();
      await expect(
        authedPage.locator("text=Zuweisung nachschlagen"),
      ).toBeVisible({ timeout: 15_000 });

      // Member re-opens the invite link of the now drawn group.
      await pageB.goto(inviteUrl);
      await expect(pageB).toHaveURL(new RegExp(`/gruppen/${slug}$`), {
        timeout: 15_000,
      });
      await expect(pageB.locator("text=Du beschenkst")).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }
  });

  test("settings: non-admin member and unknown slug both get 404", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      `Settings 404 ${Date.now()}`,
    );
    const ctxB = await browser.newContext(guestContextOptions());
    try {
      const pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+routing-s-${Date.now()}@example.com`,
      });
      const member = await pageB.goto(`/gruppen/${slug}/einstellungen`);
      expect(member?.status()).toBe(404);
      const unknown = await pageB.goto(
        "/gruppen/gibt-es-nicht-xyz/einstellungen",
      );
      expect(unknown?.status()).toBe(404);

      // Admin still reaches settings.
      const admin = await authedPage.goto(`/gruppen/${slug}/einstellungen`);
      expect(admin?.status()).toBe(200);
    } finally {
      await ctxB.close();
    }
  });
});

test.describe("return-to after login", () => {
  test("logged-out visit to a protected page returns there after OTP login", async ({
    browser,
  }) => {
    // Existing account to log in with (fresh context only used to create it).
    const { ctx: setupCtx, email } = await createFreshAuthedContext(browser);
    await setupCtx.close();

    const ctx = await browser.newContext(guestContextOptions());
    try {
      const page = await ctx.newPage();
      await page.goto("/konto");
      await expect(page).toHaveURL(/\/anmelden\?next=%2Fkonto/);

      await page.locator("#email").fill(email);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator("#otp")).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeEnabled({
        timeout: 10_000,
      });
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/konto$/, { timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test("off-origin next is ignored", async ({ browser }) => {
    const { ctx: setupCtx, email } = await createFreshAuthedContext(browser);
    await setupCtx.close();

    const ctx = await browser.newContext(guestContextOptions());
    try {
      const page = await ctx.newPage();
      await page.goto("/anmelden?next=//evil.example");
      await page.locator("#email").fill(email);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator("#otp")).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeEnabled({
        timeout: 10_000,
      });
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/gruppen$/, { timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});
