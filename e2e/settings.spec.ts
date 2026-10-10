import { type BrowserContext, type Page } from "@playwright/test";
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

test.describe("admin settings page access", () => {
  test("settings link on group detail navigates to settings page", async ({
    authedPage,
  }) => {
    const { slug } = await setupGroup(authedPage, "Settings Link Test");
    await authedPage.locator('a:has-text("Einstellungen")').click();
    await expect(authedPage).toHaveURL(`/gruppen/${slug}/einstellungen`);
    await expect(
      authedPage.getByRole("heading", { name: "Einstellungen", level: 1 }),
    ).toBeVisible();
  });

  test("participant navigating to settings URL is redirected to group detail", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Participant Access Test",
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      const guestPage = await joinViaInvite(guestCtx, inviteUrl, slug, {
        firstName: "Gustav",
        lastName: "Gast",
        email: `e2e+settings-guest-${Date.now()}@example.com`,
      });

      await guestPage.goto(`/gruppen/${slug}/einstellungen`);
      await expect(guestPage).toHaveURL(new RegExp(`/gruppen/${slug}$`), {
        timeout: 10_000,
      });
    } finally {
      await guestCtx.close();
    }
  });
});

test.describe("group info editing", () => {
  test("admin can rename the group", async ({ authedPage }) => {
    const { slug } = await setupGroup(authedPage, "Ursprünglicher Name");

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator("#name").fill("Neuer Gruppenname");
    await authedPage.locator('button:has-text("Speichern")').click();

    await expect(authedPage.locator("text=Gespeichert.")).toBeVisible({
      timeout: 10_000,
    });

    // Group detail page reflects the renamed group
    await authedPage.goto(`/gruppen/${slug}`);
    await expect(
      authedPage.getByRole("heading", { name: "Neuer Gruppenname", level: 1 }),
    ).toBeVisible();
  });

  test("slug does not change after rename", async ({ authedPage }) => {
    const { slug } = await setupGroup(authedPage, "Slug Unchanged Test");

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator("#name").fill("Völlig Anderer Name");
    await authedPage.locator('button:has-text("Speichern")').click();
    await expect(authedPage.locator("text=Gespeichert.")).toBeVisible({
      timeout: 10_000,
    });

    // URL still contains original slug
    await authedPage.locator('a:has-text("Zur Gruppe")').click();
    await expect(authedPage).toHaveURL(`/gruppen/${slug}`);
  });

  test("submitting empty name shows validation error", async ({
    authedPage,
  }) => {
    const { slug } = await setupGroup(authedPage, "Validation Test");

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator("#name").fill(" ");
    await authedPage.locator('button:has-text("Speichern")').click();

    await expect(authedPage.locator("p.text-danger-text")).toContainText(
      "Bitte gib einen Gruppennamen ein.",
    );
  });

  test("admin can set and clear budget hint", async ({ authedPage }) => {
    const { slug } = await setupGroup(authedPage, "Budget Test");

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator("#budgetHint").fill("30 €");
    await authedPage.locator('button:has-text("Speichern")').click();
    await expect(authedPage.locator("text=Gespeichert.")).toBeVisible({
      timeout: 10_000,
    });

    await authedPage.goto(`/gruppen/${slug}`);
    await expect(authedPage.locator("text=Budget-Hinweis: 30 €")).toBeVisible();
  });
});

test.describe("exclusion management", () => {
  test("admin can add and remove an exclusion pair", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Exclusion Add Remove Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+excl-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+excl-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    // Select two different members
    const selectA = authedPage.locator("#memberA");
    const selectB = authedPage.locator("#memberB");
    const optionsA = await selectA.locator("option:not([disabled])").all();
    const optionsB = await selectB.locator("option:not([disabled])").all();

    const valA = await optionsA[0].getAttribute("value");
    const valB = await optionsB[1].getAttribute("value");
    await selectA.selectOption(valA!);
    await selectB.selectOption(valB!);

    await authedPage
      .locator('button:has-text("Ausschluss hinzufügen")')
      .click();

    // Exclusion appears in list — scope to the Ausschlüsse section to avoid
    // matching the Teilnehmer section which also has "Entfernen" buttons
    const exclusionsSection = authedPage
      .locator("section")
      .filter({ hasText: "Ausschlüsse" });
    const removeBtn = exclusionsSection.locator('button:has-text("Entfernen")');
    await expect(removeBtn).toBeVisible({ timeout: 10_000 });

    // Remove it — wait for network idle so the Server Action completes before
    // navigating, then reload fresh instead of relying on router.refresh() timing
    await Promise.all([
      authedPage.waitForLoadState("networkidle"),
      removeBtn.click(),
    ]);
    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();
    await expect(
      authedPage.locator("text=Keine Ausschlüsse festgelegt."),
    ).toBeVisible();
  });

  test("selecting the same person for both slots shows error", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Same Member Exclusion Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+same-b-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
    }

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    const selectA = authedPage.locator("#memberA");
    const firstOption = await selectA
      .locator("option:not([disabled])")
      .first()
      .getAttribute("value");
    await authedPage.locator("#memberA").selectOption(firstOption!);
    await authedPage.locator("#memberB").selectOption(firstOption!);

    await authedPage
      .locator('button:has-text("Ausschluss hinzufügen")')
      .click();

    await expect(authedPage.locator("p.text-danger-text")).toContainText(
      "Bitte wähle zwei verschiedene Personen.",
      { timeout: 10_000 },
    );
  });
});

test.describe("promote to admin", () => {
  test("admin can promote a participant to admin", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Promote Admin Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Berta",
        lastName: "Bauer",
        email: `e2e+promote-b-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
    }

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    const promoteBtn = authedPage.locator(
      'button:has-text("Zum Admin machen")',
    );
    await expect(promoteBtn).toBeVisible();
    await promoteBtn.click();

    // Confirm step: cancel first, then promote for real
    await expect(
      authedPage.getByText("Berta Bauer zum Admin machen?"),
    ).toBeFocused();
    await authedPage.locator('button:has-text("Abbrechen")').click();
    await expect(promoteBtn).toBeVisible();
    await expect(promoteBtn).toBeFocused();
    await promoteBtn.click();
    await authedPage
      .getByRole("button", { name: "Zum Admin machen" })
      .last()
      .click();

    // After refresh, promoted member's row shows "Admin" badge, button gone
    await expect(promoteBtn).toHaveCount(0, { timeout: 10_000 });
    // Scope to Berta's list item — avoids false matches from buttons like "Zum Admin machen"
    const bertaRow = authedPage.locator("li").filter({ hasText: /Berta/ });
    await expect(bertaRow.getByText("Admin", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("delete group", () => {
  test("cancel in confirmation panel keeps the group and stays on settings", async ({
    authedPage,
  }) => {
    const { slug } = await setupGroup(authedPage, "Delete Cancel Test");

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator('button:has-text("Gruppe löschen")').click();

    // Confirmation panel appears
    await expect(
      authedPage.locator("text=Gruppe wirklich löschen?"),
    ).toBeVisible();

    await authedPage.locator('button:has-text("Abbrechen")').click();

    // Panel dismissed, still on settings page
    await expect(
      authedPage.locator("text=Gruppe wirklich löschen?"),
    ).not.toBeVisible();
    await expect(authedPage).toHaveURL(`/gruppen/${slug}/einstellungen`);
  });

  test("confirming delete removes the group and redirects to /gruppen", async ({
    authedPage,
  }) => {
    const { slug } = await setupGroup(authedPage, "Delete Confirm Test");

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator('button:has-text("Gruppe löschen")').click();
    await expect(
      authedPage.locator("text=Gruppe wirklich löschen?"),
    ).toBeVisible();

    await authedPage.locator('button:has-text("Endgültig löschen")').click();

    await expect(authedPage).toHaveURL("/gruppen", { timeout: 15_000 });

    // Group no longer appears in the overview
    await expect(
      authedPage.locator("text=Delete Confirm Test"),
    ).not.toBeVisible();
  });

  // Regression test for issue #138: deleting one group must not make an
  // unrelated, untouched group briefly disappear from /gruppen after the
  // post-delete redirect.
  test("deleting one group keeps an untouched group visible immediately after redirect", async ({
    authedPage,
  }) => {
    await setupGroup(authedPage, "Untouched Group");
    const { slug: throwawaySlug } = await setupGroup(
      authedPage,
      "Throwaway Group",
    );

    await authedPage.goto(`/gruppen/${throwawaySlug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator('button:has-text("Gruppe löschen")').click();
    await expect(
      authedPage.locator("text=Gruppe wirklich löschen?"),
    ).toBeVisible();

    await authedPage.locator('button:has-text("Endgültig löschen")').click();

    await expect(authedPage).toHaveURL("/gruppen", { timeout: 15_000 });

    // The untouched group must render on the very first paint of /gruppen —
    // not just after a later reload — so this intentionally does not retry
    // via a soft-matcher wait beyond Playwright's default assertion timeout.
    await expect(authedPage.locator("text=Untouched Group")).toBeVisible();
    await expect(authedPage.locator("text=Throwaway Group")).not.toBeVisible();

    // Belt-and-suspenders: a reload must keep showing the same correct state.
    await authedPage.reload();
    await expect(authedPage.locator("text=Untouched Group")).toBeVisible();
  });
});

test.describe("invite link rotation", () => {
  test("admin renews invite link; old link becomes invalid, new link works", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl: oldUrl } = await setupGroup(
      authedPage,
      "Link Rotation Test",
    );

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    const section = authedPage.getByTestId("invite-link-section");
    await expect(section).toBeVisible();
    await section
      .getByRole("button", { name: "Einladungslink erneuern" })
      .click();
    await expect(
      authedPage.locator("text=Einladungslink wirklich erneuern?"),
    ).toBeVisible();
    await section.getByRole("button", { name: "Link erneuern" }).click();
    await expect(
      authedPage.locator("text=Einladungslink erneuert."),
    ).toBeVisible({ timeout: 10_000 });

    // Group page now shows a different invite URL
    await authedPage.goto(`/gruppen/${slug}`);
    const inviteBtn = authedPage.locator("[data-invite-url]");
    await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
    const newUrl = (await inviteBtn.getAttribute("data-invite-url"))!;
    expect(newUrl).not.toBe(oldUrl);

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      // Old link: dead end
      const oldPage = await guestCtx.newPage();
      await oldPage.goto(oldUrl);
      await expect(oldPage.locator("h1")).toContainText(
        "Ungültiger Einladungslink",
      );

      // New link: join works
      await joinViaInvite(guestCtx, newUrl, slug, {
        firstName: "Neu",
        lastName: "Gast",
        email: `e2e+rotation-${Date.now()}@example.com`,
      });
    } finally {
      await guestCtx.close();
    }
  });

  test("participant cannot reach the rotation UI", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Link Rotation Access",
    );
    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      const guestPage = await joinViaInvite(guestCtx, inviteUrl, slug, {
        firstName: "Gustav",
        lastName: "Gast",
        email: `e2e+rotation-guest-${Date.now()}@example.com`,
      });
      await guestPage.goto(`/gruppen/${slug}/einstellungen`);
      await expect(guestPage).toHaveURL(new RegExp(`/gruppen/${slug}$`), {
        timeout: 10_000,
      });
      await expect(guestPage.getByTestId("invite-link-section")).toHaveCount(0);
    } finally {
      await guestCtx.close();
    }
  });
});
