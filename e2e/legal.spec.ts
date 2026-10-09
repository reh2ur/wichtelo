import { expect, test } from "@playwright/test";

test.describe("legal pages", () => {
  test("footer links to /impressum and /datenschutz from landing page", async ({
    page,
  }) => {
    await page.goto("/");

    const impressumLink = page.getByRole("link", { name: "Impressum" });
    const datenschutzLink = page.getByRole("link", { name: "Datenschutz" });
    await expect(impressumLink).toBeVisible();
    await expect(datenschutzLink).toBeVisible();

    await impressumLink.click();
    await expect(page).toHaveURL(/\/impressum/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Impressum" }),
    ).toBeVisible();

    await page.goto("/");
    await datenschutzLink.click();
    await expect(page).toHaveURL(/\/datenschutz/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Datenschutzerklärung" }),
    ).toBeVisible();
  });

  test("/impressum contains DDG §5 required fields", async ({ page }) => {
    await page.goto("/impressum");

    await expect(page.getByText("Angaben gemäß § 5 DDG")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Diensteanbieter" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kontakt" })).toBeVisible();
    await expect(page.getByText(/48 Stunden/)).toBeVisible();
  });

  test("/datenschutz discloses operator data access with legal basis", async ({
    page,
  }) => {
    await page.goto("/datenschutz");

    const section = page.getByRole("heading", {
      name: "Zugriff durch den Plattformbetreiber",
    });
    await expect(section).toBeVisible();

    const body = page.locator("section", {
      has: section,
    });
    await expect(body).toContainText("Art. 6 Abs. 1 lit. b DSGVO");
    await expect(body).toContainText("Art. 6 Abs. 1 lit. f DSGVO");
  });

  test("/datenschutz lists processors and admin oracle capability", async ({
    page,
  }) => {
    await page.goto("/datenschutz");

    await expect(
      page.locator("li").filter({ hasText: /Supabase.*Frankfurt/ }),
    ).toBeVisible();
    await expect(page.getByText(/Resend \(USA\)/)).toBeVisible();
    await expect(page.getByText(/Vercel \(USA\) — Hosting/)).toBeVisible();
    await expect(page.getByText(/Upstash \(USA\)/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Einsicht durch Gruppen-Admins" }),
    ).toBeVisible();
  });

  test("/datenschutz discloses US transfer safeguard and Speed Insights", async ({
    page,
  }) => {
    await page.goto("/datenschutz");

    await expect(
      page.getByRole("heading", { name: "Datenübermittlung in die USA" }),
    ).toBeVisible();
    await expect(page.getByText(/Data Privacy Framework/)).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Performance-Messung (Vercel Speed Insights)",
      }),
    ).toBeVisible();
  });

  test("/datenschutz discloses retention, cookies, and minors", async ({
    page,
  }) => {
    await page.goto("/datenschutz");

    await expect(
      page.getByRole("heading", { name: "Speicherdauer" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cookies" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Hinweis zu Minderjährigen" }),
    ).toBeVisible();
  });

  test("/datenschutz discloses IPs, admin email sharing, audit log and Supabase US parent", async ({
    page,
  }) => {
    await page.goto("/datenschutz");
    await expect(page.getByText(/IP-Adressen/).first()).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Sichtbarkeit innerhalb einer Gruppe",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Protokoll von Administrationsvorgängen",
      }),
    ).toBeVisible();
    await expect(page.getByText(/Supabase Inc\./).first()).toBeVisible();
  });
});
