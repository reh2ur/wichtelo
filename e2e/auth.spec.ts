import { expect, test } from "./fixtures";
import { BASE_URL, testApiHeaders, createFreshAuthedContext } from "./helpers";

test.describe("authentication", () => {
  test("anmelden page renders the email form", async ({ page }) => {
    await page.goto("/anmelden");
    await expect(page.locator("h1")).toContainText("Anmelden");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("submitting an invalid email shows an error message", async ({
    page,
  }) => {
    await page.goto("/anmelden");
    // noValidate disables browser constraint validation so requestSubmit() reaches
    // the server action, which exercises the server-side EMAIL_RE check.
    await page.locator("form").evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
      (form.querySelector("#email") as HTMLInputElement).value = "notanemail";
      form.requestSubmit();
    });
    await expect(page.locator("p.text-danger-text")).toContainText(
      "Bitte gib eine gültige E-Mail-Adresse ein.",
    );
  });

  test("navigating to /gruppen while unauthenticated redirects to /anmelden", async ({
    page,
  }) => {
    await page.goto("/gruppen");
    await expect(page).toHaveURL(/\/anmelden/);
    await expect(page.locator("h1")).toContainText("Anmelden");
  });
});

test.describe("authenticated routes", () => {
  test("authenticated user sees /gruppen", async ({ authedPage }) => {
    await authedPage.goto("/gruppen");
    await expect(authedPage).toHaveURL(/\/gruppen/);
  });
});

test.describe("stale session handling", () => {
  test("session cookie surviving deletion of the underlying account does not redirect-loop", async ({
    browser,
  }) => {
    const { ctx, email } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();

    try {
      // Sanity check: cookie is currently valid.
      await page.goto("/gruppen");
      await expect(page).toHaveURL(/\/gruppen/);

      // Simulate a stale session: the JWT cookie is still validly signed and
      // unexpired, but the auth.users row it references is now gone (e.g.
      // after a DB reset or account deletion).
      const res = await fetch(`${BASE_URL}/api/test/auth`, {
        method: "DELETE",
        headers: testApiHeaders(),
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`Stale-session setup failed: ${res.status}`);

      // Guest-only route must not bounce back to /gruppen — it must treat
      // the stale session as unauthenticated and render the login form.
      await page.goto("/anmelden");
      await expect(page).toHaveURL(/\/anmelden$/);
      await expect(page.locator("h1")).toContainText("Anmelden");

      // Protected route must also correctly reject the stale session.
      await page.goto("/gruppen");
      await expect(page).toHaveURL(/\/anmelden/);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("OTP sign-in flow", () => {
  test("full OTP sign-in for an existing account", async ({ page }) => {
    const email = `e2e+${Date.now()}@example.com`;
    // /anmelden is invite-only — pre-create the account out-of-band, the
    // same way an admin's invite would, rather than through the form itself.
    const res = await fetch(`${BASE_URL}/api/test/session`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(`Test account setup failed: ${res.status}`);

    await page.goto("/anmelden");
    await page.locator("#email").fill(email);
    await page.locator('button[type="submit"]').click();
    // requestOtp auto-fills the OTP via the admin API on dev/preview — no email needed.
    // Wait for the submit button to become enabled (disabled while otpValue.length < 6).
    await expect(page.locator("#otp")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/gruppen/);
  });

  test("shows the same OTP screen for an email with no existing account (no enumeration)", async ({
    page,
  }) => {
    const email = `e2e+never-invited-${Date.now()}@example.com`;
    await page.goto("/anmelden");
    await page.locator("#email").fill(email);
    await page.locator('button[type="submit"]').click();
    // No account exists for this email, but the response must be
    // indistinguishable from the known-account case: OTP screen shown,
    // no error message revealing account (non-)existence (see issue #104).
    await expect(page.locator("#otp")).toBeVisible();
    await expect(page.locator("p.text-danger-text")).not.toBeVisible();
  });

  test("OTP input has an accessible label and receives focus when the step appears", async ({
    page,
  }) => {
    await page.goto("/anmelden");
    await page.locator("#email").fill(`e2e+a11y-${Date.now()}@example.com`);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#otp")).toBeVisible();
    await expect(page.getByLabel("Einmal-Code")).toBeVisible();
    await expect(page.locator("#otp")).toHaveAttribute(
      "aria-describedby",
      "otp-description",
    );
    await expect(page.locator("#otp")).toBeFocused();
  });

  test("clears and refocuses the code input after a failed verification attempt", async ({
    page,
  }) => {
    const email = `e2e+${Date.now()}@example.com`;
    const res = await fetch(`${BASE_URL}/api/test/session`, {
      method: "POST",
      headers: testApiHeaders(),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(`Test account setup failed: ${res.status}`);

    await page.goto("/anmelden");
    await page.locator("#email").fill(email);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#otp")).toBeVisible();

    // Overwrite the auto-filled (correct, dev-mode) OTP with a wrong one.
    await page.locator("#otp").fill("000000");
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    await page.locator('button[type="submit"]').click();

    await expect(page.locator("p.text-danger-text")).toContainText(
      "Der Code ist ungültig oder abgelaufen.",
    );
    await expect(page.locator("#otp")).toHaveValue("");
    await expect(page.locator("#otp")).toBeFocused();
  });
});
