import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BASE_URL, browserExtraHeaders, testApiHeaders } from "./helpers";

// Emailed sign-in button: GET renders a confirm page and consumes nothing, a
// click (POST) verifies the token hash. Works in a browser that never asked
// for the code (cross-device) and survives link-scanner prefetches (#24).
//
// NOTE: the real mails only carry token_hash links once the updated templates
// are pushed to the Supabase project (`supabase config push`); these specs
// build the same URL from the test backdoor.

const LINK_ERROR =
  "Der Link ist abgelaufen oder wurde in einem anderen Browser geöffnet.";

function guestContextOptions() {
  return {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  };
}

// Creates the account (if needed) and returns a fresh token hash, exactly what
// the emailed button carries as ?token_hash=.
async function freshTokenHash(email: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/test/session`, {
    method: "POST",
    headers: testApiHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Token hash setup failed: ${res.status}`);
  const { token_hash } = await res.json();
  if (!token_hash) throw new Error("Backdoor returned no token_hash");
  return token_hash;
}

async function setupGroupInviteToken(authedPage: Page): Promise<string> {
  await authedPage.goto("/gruppen/neu");
  await expect(authedPage.locator("#name")).toBeVisible();
  if (await authedPage.locator("#firstName").isVisible()) {
    await authedPage.locator("#firstName").fill("Test");
    await authedPage.locator("#lastName").fill("Admin");
  }
  await authedPage.locator("#name").fill("Magic Link Gruppe");
  await authedPage.locator('button[type="submit"]').click();
  await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
    timeout: 15_000,
  });
  const inviteBtn = authedPage.locator("[data-invite-url]");
  await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
  const inviteUrl = (await inviteBtn.getAttribute("data-invite-url"))!;
  return inviteUrl.split("/einladung/")[1];
}

test.describe("magic link sign-in (/auth/callback)", () => {
  test("GET only shows a confirm page; clicking signs in from a fresh browser", async ({
    browser,
  }) => {
    const hash = await freshTokenHash(`e2e+magic-${Date.now()}@example.com`);
    const ctx = await browser.newContext(guestContextOptions());
    const page = await ctx.newPage();

    await page.goto(`/auth/callback?token_hash=${hash}&type=email`);
    await expect(page.locator("h1")).toContainText("Anmeldung bestätigen");

    // A prefetch/refresh must not consume the token.
    await page.reload();
    await expect(page.locator("h1")).toContainText("Anmeldung bestätigen");

    await page.getByRole("button", { name: "Jetzt anmelden" }).click();
    await expect(page).toHaveURL(/\/gruppen/);
    await ctx.close();
  });

  test("a used link shows the German error on /anmelden", async ({
    browser,
  }) => {
    const hash = await freshTokenHash(`e2e+magic-${Date.now()}@example.com`);

    const first = await browser.newContext(guestContextOptions());
    const firstPage = await first.newPage();
    await firstPage.goto(`/auth/callback?token_hash=${hash}&type=email`);
    await firstPage.getByRole("button", { name: "Jetzt anmelden" }).click();
    await expect(firstPage).toHaveURL(/\/gruppen/);
    await first.close();

    const second = await browser.newContext(guestContextOptions());
    const secondPage = await second.newPage();
    await secondPage.goto(`/auth/callback?token_hash=${hash}&type=email`);
    await secondPage.getByRole("button", { name: "Jetzt anmelden" }).click();
    await expect(secondPage).toHaveURL(/\/anmelden\?error=link_invalid/);
    await expect(secondPage.locator("p[role=alert]")).toContainText(LINK_ERROR);
    await second.close();
  });

  test("a link without token_hash (e.g. old PKCE link) shows the error", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(guestContextOptions());
    const page = await ctx.newPage();
    await page.goto("/auth/callback?code=old-pkce-code");
    await expect(page).toHaveURL(/\/anmelden\?error=link_invalid/);
    await expect(page.locator("p[role=alert]")).toContainText(LINK_ERROR);
    await ctx.close();
  });

  test("an unknown error flag renders nothing", async ({ browser }) => {
    const ctx = await browser.newContext(guestContextOptions());
    const page = await ctx.newPage();
    await page.goto("/anmelden?error=<script>");
    await expect(page.locator("h1")).toContainText("Anmelden");
    await expect(page.locator("p[role=alert]")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("magic link on an invite (/einladung/[token]/magiclink)", () => {
  test("clicking the confirm button signs in and continues the join flow", async ({
    authedPage,
    browser,
  }) => {
    const token = await setupGroupInviteToken(authedPage);
    const hash = await freshTokenHash(
      `e2e+magic-inv-${Date.now()}@example.com`,
    );

    const ctx = await browser.newContext(guestContextOptions());
    const page = await ctx.newPage();
    await page.goto(
      `/einladung/${token}/magiclink?token_hash=${hash}&type=email`,
    );
    await expect(page.locator("h1")).toContainText("Anmeldung bestätigen");
    await page.getByRole("button", { name: "Anmeldung bestätigen" }).click();

    // Signed in -> invite page now offers the name form.
    await expect(page).toHaveURL(new RegExp(`/einladung/${token}$`));
    await expect(page.locator("#firstName")).toBeVisible();
    await ctx.close();
  });

  test("an invalid link redirects to the invite with a German error", async ({
    authedPage,
    browser,
  }) => {
    const token = await setupGroupInviteToken(authedPage);

    const ctx = await browser.newContext(guestContextOptions());
    const page = await ctx.newPage();
    await page.goto(`/einladung/${token}/magiclink?code=old-pkce-code`);
    await expect(page).toHaveURL(
      new RegExp(`/einladung/${token}\\?error=link_invalid`),
    );
    await expect(page.locator("p[role=alert]")).toContainText(LINK_ERROR);
    await expect(page.locator("#email")).toBeVisible();
    await ctx.close();
  });
});
