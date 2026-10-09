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

test.describe("participant leave", () => {
  test("participant can leave a group and is redirected to /gruppen", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(authedPage, "Leave Test");

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      const guestPage = await joinViaInvite(guestCtx, inviteUrl, slug, {
        firstName: "Greta",
        lastName: "Gast",
        email: `e2e+leave-guest-${Date.now()}@example.com`,
      });

      await guestPage.locator('button:has-text("Gruppe verlassen")').click();
      await expect(
        guestPage.locator("text=Gruppe wirklich verlassen?"),
      ).toBeVisible();

      await guestPage.locator('button:has-text("Verlassen")').click();

      await expect(guestPage).toHaveURL("/gruppen", { timeout: 15_000 });
      await expect(
        guestPage.getByRole("heading", { name: "Meine Gruppen" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        guestPage.getByRole("heading", { name: "Leave Test" }),
      ).toHaveCount(0);
    } finally {
      await guestCtx.close();
    }
  });

  test("cancel leave confirmation keeps user on group detail page", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Leave Cancel Test",
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      const guestPage = await joinViaInvite(guestCtx, inviteUrl, slug, {
        firstName: "Heinz",
        lastName: "Helfer",
        email: `e2e+leave-cancel-${Date.now()}@example.com`,
      });

      await guestPage.locator('button:has-text("Gruppe verlassen")').click();
      await expect(
        guestPage.locator("text=Gruppe wirklich verlassen?"),
      ).toBeVisible();

      await guestPage.locator('button:has-text("Abbrechen")').click();

      await expect(
        guestPage.locator("text=Gruppe wirklich verlassen?"),
      ).not.toBeVisible();
      await expect(guestPage).toHaveURL(new RegExp(`/gruppen/${slug}$`));
    } finally {
      await guestCtx.close();
    }
  });

  test("sole admin cannot leave — sees last-admin error", async ({
    authedPage,
  }) => {
    const { slug } = await setupGroup(authedPage, "Last Admin Leave Test");

    await authedPage.goto(`/gruppen/${slug}`);
    await expect(
      authedPage.locator('button:has-text("Gruppe verlassen")'),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Gruppe verlassen")').click();

    await expect(
      authedPage.locator("text=Gruppe wirklich verlassen?"),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Verlassen")').click();

    await expect(
      authedPage.locator(
        "text=Du bist der einzige Admin. Befördere zuerst eine andere Person zum Admin.",
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(authedPage).toHaveURL(new RegExp(`/gruppen/${slug}$`));
  });
});

test.describe("admin remove participant", () => {
  test("admin can remove a participant pre-draw", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Admin Remove Test",
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      await joinViaInvite(guestCtx, inviteUrl, slug, {
        firstName: "Rolf",
        lastName: "Raus",
        email: `e2e+remove-guest-${Date.now()}@example.com`,
      });
    } finally {
      await guestCtx.close();
    }

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    const removeBtn = authedPage
      .locator("li")
      .filter({ hasText: /Rolf/ })
      .locator('button:has-text("Entfernen")');
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    await expect(
      authedPage.locator("text=Teilnehmer wirklich entfernen?"),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Endgültig entfernen")').click();

    await expect(
      authedPage.locator("li").filter({ hasText: /Rolf/ }),
    ).not.toBeVisible({ timeout: 10_000 });

    // Admin is nudged to renew the invite link (#187)
    await expect(authedPage.getByTestId("removed-invite-hint")).toBeVisible();
  });

  test("remove button is hidden post-draw", async ({ authedPage, browser }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Remove Hidden PostDraw Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bodo",
        lastName: "Bauer",
        email: `e2e+remove-pd-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Carla",
        lastName: "Conrad",
        email: `e2e+remove-pd-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    // Trigger draw
    await authedPage.goto(`/gruppen/${slug}`);
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await expect(
      authedPage.getByText("Ausgelost", { exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    // Confirm draw button is fully gone — ensures RSC re-render with drawn state completed
    await expect(
      authedPage.locator('button:has-text("Auslosung starten")'),
    ).toHaveCount(0);

    // Settings page should show no "Entfernen" buttons
    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();
    // Reload to bypass any stale Supabase pooler read on Vercel preview envs
    await authedPage.reload();
    await expect(authedPage.locator("#name")).toBeVisible();

    // Scope to Teilnehmer section by its heading — exclusion "Entfernen" buttons may still exist
    const participantsSection = authedPage
      .locator("section")
      .filter({ has: authedPage.getByRole("heading", { name: "Teilnehmer" }) });
    await expect(
      participantsSection.locator('button:has-text("Entfernen")'),
    ).toHaveCount(0);
  });

  test("cancel remove confirmation keeps participant in list", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Remove Cancel Test",
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      await joinViaInvite(guestCtx, inviteUrl, slug, {
        firstName: "Karl",
        lastName: "Krebs",
        email: `e2e+remove-cancel-${Date.now()}@example.com`,
      });
    } finally {
      await guestCtx.close();
    }

    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    const removeBtn = authedPage
      .locator("li")
      .filter({ hasText: /Karl/ })
      .locator('button:has-text("Entfernen")');
    await removeBtn.click();

    await expect(
      authedPage.locator("text=Teilnehmer wirklich entfernen?"),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Abbrechen")').click();

    await expect(
      authedPage.locator("text=Teilnehmer wirklich entfernen?"),
    ).not.toBeVisible();
    await expect(
      authedPage.locator("li").filter({ hasText: /Karl/ }),
    ).toBeVisible();
  });
});

test.describe("leave after draw", () => {
  test("participant cannot leave once group is drawn", async ({
    authedPage,
    browser,
  }) => {
    // Two guest joins + draw + reload: exceeds default 30s on slow previews.
    test.setTimeout(90_000);
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Leave After Draw Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());
    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bodo",
        lastName: "Bauer",
        email: `e2e+leave-pd-b-${Date.now()}@example.com`,
      });
      const pageC = await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Carla",
        lastName: "Conrad",
        email: `e2e+leave-pd-c-${Date.now()}@example.com`,
      });

      await authedPage.goto(`/gruppen/${slug}`);
      await authedPage.locator('button:has-text("Auslosung starten")').click();
      await expect(
        authedPage.getByText("Ausgelost", { exact: true }),
      ).toBeVisible({
        timeout: 15_000,
      });

      await pageC.reload();
      await expect(pageC.getByTestId("leave-drawn-blocked")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        pageC.locator('button:has-text("Gruppe verlassen")'),
      ).toHaveCount(0);
    } finally {
      await ctxB.close();
      await ctxC.close();
    }
  });
});
