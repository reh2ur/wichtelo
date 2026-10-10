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

test.describe("draw trigger", () => {
  test("admin sees not-enough-members hint when fewer than 3 participants", async ({
    authedPage,
  }) => {
    await setupGroup(authedPage, "Zu wenige Teilnehmer");

    // Only the admin is in the group — button must not appear, hint must
    await expect(
      authedPage.locator('button:has-text("Auslosung starten")'),
    ).not.toBeVisible();
    await expect(
      authedPage.locator(
        "text=Es werden mindestens 3 Teilnehmer benötigt, um eine Auslosung zu starten.",
      ),
    ).toBeVisible();
  });

  test("admin sees draw button once 3 members have joined", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Drei Teilnehmer Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+draw-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+draw-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    // Admin reloads to pick up updated participant count
    await authedPage.goto(`/gruppen/${slug}`);
    const startBtn = authedPage.locator('button:has-text("Auslosung starten")');
    await expect(startBtn).toBeVisible();

    // First draw needs confirmation: clicking only opens the panel
    await startBtn.click();
    await expect(
      authedPage.getByText(
        "Danach kann niemand mehr beitreten, alle erhalten eine E-Mail.",
      ),
    ).toBeVisible();
    await expect(
      authedPage.getByText("Auslosung starten?", { exact: true }),
    ).toBeFocused();
    await expect(
      authedPage.locator('button:has-text("Jetzt auslosen")'),
    ).toBeVisible();

    // Cancel restores the trigger (with focus) and nothing is drawn
    await authedPage.locator('button:has-text("Abbrechen")').click();
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeFocused();
    await expect(
      authedPage.locator('button:has-text("Jetzt auslosen")'),
    ).not.toBeVisible();
  });

  test("golden path: admin triggers draw, state becomes drawn, assignments visible", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Auslosung Goldenpath",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());
    const emailB = `e2e+golden-b-${Date.now()}@example.com`;
    const emailC = `e2e+golden-c-${Date.now()}@example.com`;

    let pageB: Page;

    try {
      pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: emailB,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: emailC,
      });

      // Admin triggers the draw
      await authedPage.goto(`/gruppen/${slug}`);
      await expect(
        authedPage.locator('button:has-text("Auslosung starten")'),
      ).toBeVisible();
      await authedPage.locator('button:has-text("Auslosung starten")').click();
      await authedPage.locator('button:has-text("Jetzt auslosen")').click();

      // Oracle section appears once page re-renders with drawn state
      await expect(
        authedPage.locator("text=Zuweisung nachschlagen"),
      ).toBeVisible({ timeout: 15_000 });

      // Participant B sees their recipient, along with the admin-lookup disclosure
      await pageB.reload();
      await expect(pageB.locator("text=Du beschenkst")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        pageB.locator("text=Der Admin dieser Gruppe kann bei Bedarf"),
      ).toBeVisible();

      // Invite link now shows dead-end
      const deadEndCtx = await browser.newContext(guestContextOptions());
      try {
        const deadEndPage = await deadEndCtx.newPage();
        await deadEndPage.goto(inviteUrl);
        await expect(
          deadEndPage.locator("text=Auslosung bereits erfolgt"),
        ).toBeVisible();
        await deadEndPage.close();
      } finally {
        await deadEndCtx.close();
      }
    } finally {
      await ctxB.close();
      await ctxC.close();
    }
  });

  test("admin can re-draw after first draw", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(authedPage, "Re-draw Test");

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+redraw-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+redraw-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    // First draw
    await authedPage.goto(`/gruppen/${slug}`);
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await authedPage.locator('button:has-text("Jetzt auslosen")').click();
    await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible(
      { timeout: 15_000 },
    );

    // Admin is a participant too and sees their own assignment card (#184)
    await expect(authedPage.locator("text=Du beschenkst")).toBeVisible();

    // Re-draw button visible
    await expect(
      authedPage.locator('button:has-text("Neu auslosen")'),
    ).toBeVisible();

    // Trigger re-draw with confirmation
    await authedPage.locator('button:has-text("Neu auslosen")').click();
    await expect(
      authedPage.locator("text=Auslosung wirklich wiederholen?"),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Wiederholen")').click();

    // Oracle section still visible after re-draw succeeds
    await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible(
      { timeout: 15_000 },
    );
  });

  test("admin can resend draw emails after a reported partial failure", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(authedPage, "Resend Test");

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());
    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+resend-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+resend-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    await authedPage.goto(`/gruppen/${slug}`);
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await authedPage.locator('button:has-text("Jetzt auslosen")').click();
    await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible(
      { timeout: 15_000 },
    );

    // No failure reported yet: no resend button.
    await expect(
      authedPage.locator('button:has-text("erneut senden")'),
    ).toHaveCount(0);

    // Real provider failures can't be forced; simulate the stored warning the
    // draw button sets after a partial failure, then reload.
    await authedPage.evaluate((s) => {
      sessionStorage.setItem(
        `draw-email-warning:${s}`,
        JSON.stringify({ failed: 1, total: 3 }),
      );
    }, slug);
    await authedPage.reload();

    await expect(
      authedPage.locator("text=1 von 3 E-Mails konnten nicht zugestellt"),
    ).toBeVisible({ timeout: 15_000 });
    await authedPage
      .locator('button:has-text("Fehlgeschlagene E-Mails erneut senden")')
      .click();

    await expect(
      authedPage.locator("text=Alle E-Mails wurden zugestellt."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      authedPage.locator("text=1 von 3 E-Mails konnten nicht zugestellt"),
    ).toHaveCount(0);
  });

  test("participant does not see the resend button", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Resend Guard Test",
    );
    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());
    let pageB: Page;
    try {
      pageB = await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+resendg-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+resendg-c-${Date.now()}@example.com`,
      });

      await authedPage.goto(`/gruppen/${slug}`);
      await authedPage.locator('button:has-text("Auslosung starten")').click();
      await authedPage.locator('button:has-text("Jetzt auslosen")').click();
      await expect(
        authedPage.locator("text=Zuweisung nachschlagen"),
      ).toBeVisible({ timeout: 15_000 });

      await pageB.evaluate((s) => {
        sessionStorage.setItem(
          `draw-email-warning:${s}`,
          JSON.stringify({ failed: 1, total: 3 }),
        );
      }, slug);
      await pageB.reload();
      await expect(pageB.locator("h1")).toBeVisible();
      await expect(
        pageB.locator('button:has-text("erneut senden")'),
      ).toHaveCount(0);
    } finally {
      await ctxB.close();
      await ctxC.close();
    }
  });

  test("admin oracle: lookup single assignment with confirmation", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(authedPage, "Oracle Test");

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+oracle-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+oracle-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    // Trigger draw
    await authedPage.goto(`/gruppen/${slug}`);
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await authedPage.locator('button:has-text("Jetzt auslosen")').click();
    await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible(
      { timeout: 15_000 },
    );

    // Select first non-empty option from oracle dropdown
    await authedPage.locator("#oracle-select").selectOption({ index: 1 });

    // Click lookup button
    await authedPage.locator('button:has-text("Nachschlagen")').click();

    // Confirmation panel appears
    await expect(
      authedPage.locator("text=Zuweisung wirklich anzeigen?"),
    ).toBeVisible();

    // Confirm
    await authedPage.locator('button:has-text("Anzeigen")').click();

    // Result shows assignment
    await expect(authedPage.locator("text=beschenkt:")).toBeVisible({
      timeout: 10_000,
    });

    // Reset button available
    await expect(
      authedPage.locator('button:has-text("Neue Suche")'),
    ).toBeVisible();
  });

  test("unsolvable draw shows error when exclusions block all valid assignments", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Unsolvable Draw Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+unsolvable-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+unsolvable-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    // With 3 members, any single exclusion makes all valid derangements impossible.
    await authedPage.goto(`/gruppen/${slug}/einstellungen`);
    await expect(authedPage.locator("#name")).toBeVisible();

    const selectA = authedPage.locator("#memberA");
    const selectB = authedPage.locator("#memberB");
    const optionsA = await selectA.locator("option:not([disabled])").all();
    const optionsB = await selectB.locator("option:not([disabled])").all();
    await selectA.selectOption((await optionsA[0].getAttribute("value")) ?? "");
    await selectB.selectOption((await optionsB[1].getAttribute("value")) ?? "");
    await authedPage
      .locator('button:has-text("Ausschluss hinzufügen")')
      .click();
    await expect(
      authedPage.locator("ul").filter({
        has: authedPage.locator('button:has-text("Entfernen")'),
      }),
    ).toBeVisible({ timeout: 10_000 });

    // Trigger draw — must fail because no valid derangement exists.
    await authedPage.goto(`/gruppen/${slug}`);
    await expect(
      authedPage.locator('button:has-text("Auslosung starten")'),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await authedPage.locator('button:has-text("Jetzt auslosen")').click();

    await expect(
      authedPage.locator(
        "text=Die Auslosung ist mit den aktuellen Ausschlüssen nicht möglich.",
      ),
    ).toBeVisible({ timeout: 10_000 });
    // Group stays open — confirm panel remains so the admin can retry or cancel.
    await expect(
      authedPage.locator('button:has-text("Jetzt auslosen")'),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Abbrechen")').click();
    await expect(
      authedPage.locator('button:has-text("Auslosung starten")'),
    ).toBeVisible();
  });

  test("re-draw cancel dismisses confirmation panel without changing state", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Redraw Cancel Test",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+rdcancel-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+rdcancel-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    // First draw
    await authedPage.goto(`/gruppen/${slug}`);
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await authedPage.locator('button:has-text("Jetzt auslosen")').click();
    await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible(
      { timeout: 15_000 },
    );

    // Open re-draw confirmation then cancel.
    await authedPage.locator('button:has-text("Neu auslosen")').click();
    await expect(
      authedPage.locator("text=Auslosung wirklich wiederholen?"),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Abbrechen")').click();

    // Panel dismissed, page state unchanged.
    await expect(
      authedPage.locator("text=Auslosung wirklich wiederholen?"),
    ).not.toBeVisible();
    await expect(
      authedPage.locator("text=Zuweisung nachschlagen"),
    ).toBeVisible();
  });

  test("invite dead-end shown after draw (standalone)", async ({
    authedPage,
    browser,
  }) => {
    const { slug, inviteUrl } = await setupGroup(
      authedPage,
      "Deadend Test Draw",
    );

    const ctxB = await browser.newContext(guestContextOptions());
    const ctxC = await browser.newContext(guestContextOptions());

    try {
      await joinViaInvite(ctxB, inviteUrl, slug, {
        firstName: "Bernd",
        lastName: "Becker",
        email: `e2e+deadend-b-${Date.now()}@example.com`,
      });
      await joinViaInvite(ctxC, inviteUrl, slug, {
        firstName: "Clara",
        lastName: "Conrad",
        email: `e2e+deadend-c-${Date.now()}@example.com`,
      });
    } finally {
      await ctxB.close();
      await ctxC.close();
    }

    await authedPage.goto(`/gruppen/${slug}`);
    await expect(
      authedPage.locator('button:has-text("Auslosung starten")'),
    ).toBeVisible();
    await authedPage.locator('button:has-text("Auslosung starten")').click();
    await authedPage.locator('button:has-text("Jetzt auslosen")').click();
    // Oracle section appears once page re-renders with drawn state
    await expect(authedPage.locator("text=Zuweisung nachschlagen")).toBeVisible(
      { timeout: 15_000 },
    );

    const guestCtx = await browser.newContext(guestContextOptions());
    try {
      const guestPage = await guestCtx.newPage();
      await guestPage.goto(inviteUrl);
      await expect(
        guestPage.locator("text=Auslosung bereits erfolgt"),
      ).toBeVisible();
      await expect(
        guestPage.locator("text=Du kannst dieser Gruppe nicht mehr beitreten."),
      ).toBeVisible();
    } finally {
      await guestCtx.close();
    }
  });
});
