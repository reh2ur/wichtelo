import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  BASE_URL,
  createFreshAuthedContext,
  browserExtraHeaders,
} from "./helpers";

// Creates a group via the UI as the authedPage user and returns the slug + invite URL.
// The invite URL is read from the data-invite-url attribute on the copy button.
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
  // Wait for Suspense-rendered invite button (server-side token fetch)
  const inviteBtn = authedPage.locator("[data-invite-url]");
  await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
  const inviteUrl = await inviteBtn.getAttribute("data-invite-url");
  const slug = authedPage.url().split("/gruppen/")[1];
  return { slug, inviteUrl: inviteUrl! };
}

function guestContextOptions() {
  return {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: BASE_URL.includes("localhost"),
    extraHTTPHeaders: browserExtraHeaders(),
  };
}

test.describe("invite page", () => {
  test("admin sees invite link copy button on open group", async ({
    authedPage,
  }) => {
    await setupGroup(authedPage, "Invite Button Test");
    await expect(authedPage.locator("[data-invite-url]")).toBeVisible();
  });

  test("valid token renders group name and auth form for guest", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl } = await setupGroup(authedPage, "Gültige Einladung");

    const guestCtx = await browser.newContext(guestContextOptions());
    const guestPage = await guestCtx.newPage();

    await guestPage.goto(inviteUrl);
    await expect(guestPage.locator("h1")).toContainText("Gültige Einladung");
    await expect(
      guestPage.locator("text=Du wurdest zu einer Wichtel-Gruppe eingeladen."),
    ).toBeVisible();
    // Not logged in → auth form with "Weiter" button
    await expect(guestPage.locator('button[type="submit"]')).toContainText(
      "Weiter",
    );
    // Name fields are NOT shown at auth step
    await expect(guestPage.locator("#firstName")).not.toBeVisible();

    await guestCtx.close();
  });

  test("invalid token shows not-found page with 404 status", async ({
    page,
  }) => {
    const response = await page.goto(
      "/einladung/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("Seite nicht gefunden");
  });

  test("invalid token 404 is server-rendered without JS", async ({
    request,
  }) => {
    const response = await request.get(`/einladung/${crypto.randomUUID()}`);
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).toContain('lang="de"');
    expect(html).toContain('rel="stylesheet"');
    expect(html).toMatch(/<h1[^>]*>Seite nicht gefunden/);
    expect(html).not.toContain("__next_error__");
  });

  test("new user joins group via OTP invite", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl, slug } = await setupGroup(
      authedPage,
      "Neuer Nutzer Einladung",
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    const guestPage = await guestCtx.newPage();

    await guestPage.goto(inviteUrl);

    // Auth step: only email field visible, NO name fields
    await expect(guestPage.locator("#email")).toBeVisible();
    await expect(guestPage.locator("#firstName")).not.toBeVisible();
    const email = `e2e+invite-${Date.now()}@example.com`;
    await guestPage.locator("#email").fill(email);
    await guestPage.locator('button[type="submit"]').click();

    // OTP phase — dev mode auto-fills via generateLink
    await expect(guestPage.locator("#otp")).toBeVisible();
    // a11y: labelled and focused (#188)
    await expect(guestPage.getByLabel("Einmal-Code")).toBeVisible();
    await expect(guestPage.locator("#otp")).toBeFocused();
    await expect(guestPage.locator('button[type="submit"]')).toBeEnabled();
    await guestPage.locator('button[type="submit"]').click();

    // After OTP, page redirects back to invite URL → accept form appears
    await expect(guestPage.locator("#firstName")).toBeVisible();

    // Fill name fields and click Beitreten
    await guestPage.locator("#firstName").fill("Neu");
    await guestPage.locator("#lastName").fill("Nutzer");
    await guestPage.locator('button:has-text("Beitreten")').click();

    // Should land on the group detail page
    await expect(guestPage).toHaveURL(new RegExp(`/gruppen/${slug}`));

    await guestCtx.close();
  });

  test("already-member is redirected to group page", async ({ authedPage }) => {
    // authedPage user creates a group (becomes admin/member)
    const { inviteUrl, slug } = await setupGroup(
      authedPage,
      "Mitglied Redirect Test",
    );

    // Visiting own invite URL → already a member → server redirects to group
    await authedPage.goto(inviteUrl);
    await expect(authedPage).toHaveURL(new RegExp(`/gruppen/${slug}`));
  });

  test("accept form shows after OTP redirect back to invite URL", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl } = await setupGroup(
      authedPage,
      "OTP Redirect Accept Test",
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    const guestPage = await guestCtx.newPage();

    await guestPage.goto(inviteUrl);

    // Auth step
    const email = `e2e+otp-redirect-${Date.now()}@example.com`;
    await guestPage.locator("#email").fill(email);
    await guestPage.locator('button[type="submit"]').click();

    // OTP phase
    await expect(guestPage.locator("#otp")).toBeVisible();
    await guestPage.locator('button[type="submit"]').click();

    // After OTP verify, page reloads to invite URL with accept form
    await expect(guestPage).toHaveURL(new RegExp(`/einladung/`));
    // Accept form is shown (new user → name fields visible)
    await expect(guestPage.locator("#firstName")).toBeVisible();
    // Beitreten button
    await expect(
      guestPage.locator('button:has-text("Beitreten")'),
    ).toBeVisible();

    await guestCtx.close();
  });

  test("OTP step: resend works, back + same email returns to OTP step", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl } = await setupGroup(authedPage, "OTP Resend Test");
    const guestCtx = await browser.newContext(guestContextOptions());
    const guestPage = await guestCtx.newPage();
    await guestPage.goto(inviteUrl);

    const email = `e2e+resend-${Date.now()}@example.com`;
    await guestPage.locator("#email").fill(email);
    await guestPage.locator('button[type="submit"]').click();
    await expect(guestPage.locator("#otp")).toBeVisible();

    await guestPage.getByRole("button", { name: "Code erneut senden" }).click();
    await expect(guestPage.getByRole("status")).toContainText("neuen Code");

    // Back to the email form, submit the same email again -> OTP step again
    await guestPage.getByRole("button", { name: "Andere E-Mail" }).click();
    await expect(guestPage.locator("#email")).toBeVisible();
    await guestPage.locator("#email").fill(email);
    await guestPage.locator('button[type="submit"]').click();
    await expect(guestPage.locator("#otp")).toBeVisible();

    // Wrong code clears the field and refocuses it
    await guestPage.locator("#otp").fill("000000");
    await guestPage.locator('button[type="submit"]').click();
    await expect(guestPage.locator("p.text-destructive")).toBeVisible();
    await expect(guestPage.locator("#otp")).toHaveValue("");

    await guestCtx.close();
  });

  test("logged-in user sees which account is joining and can sign out", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl } = await setupGroup(authedPage, "Signed In As Test");
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();
    await page.goto(inviteUrl);
    await expect(page.getByTestId("signed-in-as")).toContainText(
      "Angemeldet als",
    );
    await page.getByRole("button", { name: "Nicht du? Abmelden" }).click();
    await expect(page).toHaveURL(/\/einladung\//);
    await expect(page.locator("#email")).toBeVisible();
    await ctx.close();
  });

  test("authenticated user without profile sees accept form directly (no OTP step)", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl, slug } = await setupGroup(
      authedPage,
      "Auth User Direct Accept Test",
    );

    // Fresh authed user has a session but no profile row.
    const { ctx: freshCtx } = await createFreshAuthedContext(browser);
    const freshPage = await freshCtx.newPage();

    try {
      await freshPage.goto(inviteUrl);

      // Logged-in user skips email/OTP — accept form shown immediately.
      await expect(freshPage.locator("#email")).not.toBeVisible();
      // No profile → name fields required.
      await expect(freshPage.locator("#firstName")).toBeVisible({
        timeout: 10_000,
      });
      await expect(freshPage.locator("#lastName")).toBeVisible();

      await freshPage.locator("#firstName").fill("Direkt");
      await freshPage.locator("#lastName").fill("Beitritt");
      await freshPage.locator('button:has-text("Beitreten")').click();

      await expect(freshPage).toHaveURL(new RegExp(`/gruppen/${slug}`), {
        timeout: 15_000,
      });
    } finally {
      await freshCtx.close();
    }
  });

  test("invite link keeps working for a second guest after the first joins", async ({
    authedPage,
    browser,
  }) => {
    const { inviteUrl, slug } = await setupGroup(
      authedPage,
      "Zweiter Gast Test",
    );

    // Guest 1 joins fully via the shared invite link.
    const guest1Ctx = await browser.newContext(guestContextOptions());
    const guest1 = await guest1Ctx.newPage();
    await guest1.goto(inviteUrl);
    await guest1
      .locator("#email")
      .fill(`e2e+invite-g1-${Date.now()}@example.com`);
    await guest1.locator('button[type="submit"]').click();
    await expect(guest1.locator("#otp")).toBeVisible();
    await guest1.locator('button[type="submit"]').click();
    await expect(guest1.locator("#firstName")).toBeVisible();
    await guest1.locator("#firstName").fill("Gast");
    await guest1.locator("#lastName").fill("Eins");
    await guest1.locator('button:has-text("Beitreten")').click();
    await expect(guest1).toHaveURL(new RegExp(`/gruppen/${slug}`));
    await guest1Ctx.close();

    // The exact same invite link, opened in a fresh guest session, must
    // still show the join form — not the "invalid invite" dead end.
    const guest2Ctx = await browser.newContext(guestContextOptions());
    const guest2 = await guest2Ctx.newPage();
    await guest2.goto(inviteUrl);
    await expect(guest2.locator("h1")).toContainText("Zweiter Gast Test");
    await expect(guest2.locator("#email")).toBeVisible();
    await guest2Ctx.close();
  });

  // Dead-end (drawn group) full E2E coverage is in draw.spec.ts.
});
