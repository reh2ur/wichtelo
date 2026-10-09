import { type BrowserContext, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  BASE_URL,
  createFreshAuthedContext,
  browserExtraHeaders,
} from "./helpers";

function guestContextOptions() {
  return {
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

test.describe("groups overview", () => {
  test("/gruppen renders heading and empty state for new user", async ({
    browser,
  }) => {
    // Must use a fresh user — the worker-scoped authedPage accumulates groups
    // from other tests in the same worker, hiding the empty state.
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();
    try {
      await page.goto("/gruppen");
      await expect(page.locator("h1")).toContainText("Meine Gruppen");
      await expect(
        page.locator("text=Du bist noch in keiner Gruppe."),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("/gruppen has link to create new group", async ({ authedPage }) => {
    await authedPage.goto("/gruppen");
    await expect(authedPage.locator("a[href='/gruppen/neu']")).toBeVisible();
  });

  test("/gruppen redirects unauthenticated to /anmelden", async ({ page }) => {
    await page.goto("/gruppen");
    await expect(page).toHaveURL(/\/anmelden/);
  });
});

test.describe("create group page", () => {
  test("/gruppen/neu shows form", async ({ authedPage }) => {
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("h1")).toContainText("Neue Gruppe");
    await expect(authedPage.locator("#name")).toBeVisible();
    await expect(authedPage.locator("#year")).toBeVisible();
    await expect(authedPage.locator('button[type="submit"]')).toContainText(
      "Gruppe erstellen",
    );
  });

  test("/gruppen/neu redirects unauthenticated to /anmelden", async ({
    page,
  }) => {
    await page.goto("/gruppen/neu");
    await expect(page).toHaveURL(/\/anmelden/);
  });

  test("submitting empty name shows validation error", async ({
    authedPage,
  }) => {
    await authedPage.goto("/gruppen/neu");
    // Wait for Suspense to resolve before checking profile section visibility.
    await expect(authedPage.locator("#name")).toBeVisible();
    const hasProfileSection = await authedPage
      .locator("#firstName")
      .isVisible();
    if (hasProfileSection) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Nutzer");
    }
    // Whitespace-only name passes browser required check (non-empty) but
    // server trims it to "" → missing_name error.
    await authedPage.locator("#name").fill(" ");
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage.locator("p.text-destructive")).toContainText(
      "Bitte gib einen Gruppennamen ein.",
    );
  });
});

test.describe("create group flow", () => {
  test("filling the form creates a group and redirects to group detail", async ({
    authedPage,
  }) => {
    await authedPage.goto("/gruppen/neu");
    // Wait for Suspense to resolve before checking profile section visibility.
    await expect(authedPage.locator("#name")).toBeVisible();
    const hasProfileSection = await authedPage
      .locator("#firstName")
      .isVisible();
    if (hasProfileSection) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Nutzer");
    }
    await authedPage.locator("#name").fill("E2E Testgruppe");
    await authedPage.locator('button[type="submit"]').click();

    // Server action redirects to /gruppen/<slug> — URL must not be /gruppen/neu.
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/);
    await expect(
      authedPage.getByRole("heading", { name: "E2E Testgruppe", level: 1 }),
    ).toBeVisible();
  });

  test("newly created group appears in /gruppen overview", async ({
    authedPage,
  }) => {
    await authedPage.goto("/gruppen/neu");
    // Wait for Suspense to resolve before checking profile section visibility.
    await expect(authedPage.locator("#name")).toBeVisible();
    const hasProfileSection = await authedPage
      .locator("#firstName")
      .isVisible();
    if (hasProfileSection) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Nutzer");
    }
    await authedPage.locator("#name").fill("Übersicht Testgruppe");
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/);

    await authedPage.goto("/gruppen");
    await expect(authedPage.locator("text=Übersicht Testgruppe")).toBeVisible();
  });
});

test.describe("create group as first-time user", () => {
  test("new user sees profile name fields and creates group successfully", async ({
    browser,
  }) => {
    // Use a fresh user guaranteed to have no profile row.
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();

    try {
      await page.goto("/gruppen/neu");
      await expect(page.locator("#name")).toBeVisible();

      // Profile section must be visible for a user with no profile.
      await expect(page.locator("#firstName")).toBeVisible();
      await expect(page.locator("#lastName")).toBeVisible();

      await page.locator("#firstName").fill("Erstnutzer");
      await page.locator("#lastName").fill("Neu");
      await page.locator("#name").fill("Erstgruppe");
      await page.locator('button[type="submit"]').click();

      await expect(page).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
        timeout: 15_000,
      });
      await expect(
        page.getByRole("heading", { name: "Erstgruppe", level: 1 }),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

test.describe("group note field", () => {
  test("admin can set and view group note on detail page", async ({
    authedPage,
  }) => {
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage.locator("#name").fill("Notiz Gruppe");
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/);
    const slug = authedPage.url().split("/gruppen/")[1];

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    await authedPage.locator("#note").fill("Bitte praktische Geschenke");
    await authedPage.locator('button:has-text("Speichern")').click();
    await expect(authedPage.locator("text=Gespeichert.")).toBeVisible({
      timeout: 10_000,
    });

    await authedPage.goto(`/gruppen/${slug}`);
    await expect(
      authedPage.locator("text=Bitte praktische Geschenke"),
    ).toBeVisible();
  });
});

test.describe("participant list name display", () => {
  test("admin sees full names, non-admin sees abbreviated/omitted last names", async ({
    authedPage,
    browser,
  }) => {
    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("User");
    }
    await authedPage.locator("#name").fill("Namen Testgruppe");
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 15_000,
    });
    await authedPage.waitForLoadState("domcontentloaded");
    const inviteBtn = authedPage.locator("[data-invite-url]");
    await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
    const inviteUrl = (await inviteBtn.getAttribute("data-invite-url"))!;
    const slug = authedPage.url().split("/gruppen/")[1];

    // The authedPage fixture's profile is created once per worker and reused
    // across earlier tests in this file, so the admin's last name isn't
    // necessarily "User" — capture the full name actually shown (admin
    // viewer always sees the full name_snapshot) instead of assuming it.
    const adminFullName = (
      await authedPage.locator("ul.space-y-2 li span.font-medium").innerText()
    ).trim();
    const adminFirstName = adminFullName.split(/\s+/)[0];

    const ctxB = await browser.newContext(guestContextOptions());
    let pageB: Page | undefined;
    try {
      // Distinct first name, different last name — first names are unique
      // within the group, so both last names must be fully omitted for the
      // non-admin viewer.
      pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Anna",
        lastName: "Beispiel",
        email: `e2e+names-b-${Date.now()}@example.com`,
      });

      // Admin still sees full last names for everyone.
      await authedPage.goto(`/gruppen/${slug}`);
      await expect(authedPage.locator(`text=${adminFullName}`)).toBeVisible();
      await expect(authedPage.locator("text=Anna Beispiel")).toBeVisible();

      // Non-admin sees first names only — last names omitted entirely.
      await expect(pageB.locator(`text=${adminFullName}`)).not.toBeVisible();
      await expect(pageB.locator("text=Anna Beispiel")).not.toBeVisible();
      const roster = pageB.locator("ul li");
      await expect(roster.filter({ hasText: adminFirstName })).toBeVisible();
      await expect(roster.filter({ hasText: "Anna" })).toBeVisible();
    } finally {
      await ctxB.close();
    }
  });
});

test.describe("groups overview sections", () => {
  test("past year group appears in Vergangene Gruppen section", async ({
    authedPage,
  }) => {
    const pastYear = new Date().getFullYear() - 1;

    await authedPage.goto("/gruppen/neu");
    await expect(authedPage.locator("#name")).toBeVisible();
    if (await authedPage.locator("#firstName").isVisible()) {
      await authedPage.locator("#firstName").fill("Test");
      await authedPage.locator("#lastName").fill("Admin");
    }
    await authedPage.locator("#name").fill(`Altgruppe ${pastYear}`);
    // Select past year from the year dropdown.
    await authedPage.locator("#year").selectOption(String(pastYear));
    await authedPage.locator('button[type="submit"]').click();
    await expect(authedPage).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
      timeout: 10_000,
    });

    await authedPage.goto("/gruppen");
    // "Vergangene Gruppen" section exists as a <details> summary.
    const pastSection = authedPage.locator("text=Vergangene Gruppen");
    await expect(pastSection).toBeVisible();
    // Open the collapsible section to reveal past groups.
    await pastSection.click();
    await expect(
      authedPage.locator(`text=Altgruppe ${pastYear}`),
    ).toBeVisible();
  });
});
