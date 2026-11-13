import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  BASE_URL,
  createFreshAuthedContext,
  browserExtraHeaders,
} from "./helpers";

/** Quick-add a wish and land on its details step (`?edit=<id>`). */
async function quickAdd(page: Page, title: string) {
  const form = page.getByTestId("wish-quick-add");
  await expect(form.getByRole("button")).toBeEnabled();
  await form.getByLabel("Neuer Wunsch").fill(title);
  await form.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(page).toHaveURL(/\/wuensche\?edit=/);
  await expect(page.getByTestId("wish-edit-form")).toBeVisible();
}

async function saveDetails(page: Page) {
  const form = page.getByTestId("wish-edit-form");
  await expect(form.getByRole("button", { name: "Speichern" })).toBeEnabled();
  await form.getByRole("button", { name: "Speichern" }).click();
}

test.describe("wishes: access", () => {
  test("unauthenticated → redirect to /anmelden", async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: BASE_URL.includes("localhost"),
      extraHTTPHeaders: browserExtraHeaders(),
    });
    const page = await ctx.newPage();
    await page.goto("/wuensche");
    await expect(page).toHaveURL(/\/anmelden/);
    await ctx.close();
  });

  test("nav menu links to /wuensche", async ({ browser }) => {
    const { ctx } = await createFreshAuthedContext(browser, {
      withProfile: true,
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/gruppen");
      await page.getByRole("button", { name: "Menü öffnen" }).click();
      await page.getByRole("menuitem", { name: "Wünsche" }).click();
      await expect(page).toHaveURL(/\/wuensche$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Meine Wünsche" }),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

test.describe("wishes: flow", () => {
  test("empty state, quick-add + details, archive, reopen, delete", async ({
    browser,
  }) => {
    const { ctx } = await createFreshAuthedContext(browser, {
      withProfile: true,
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/wuensche");
      await expect(
        page.getByRole("heading", { level: 1, name: "Meine Wünsche" }),
      ).toBeVisible();
      await expect(page.getByTestId("wish-empty")).toContainText(
        "Noch keine offenen Wünsche",
      );

      // Step 1: title only. Step 2: details.
      await quickAdd(page, "Wollsocken");
      const form = page.getByTestId("wish-edit-form");
      await form.getByLabel("Link").fill("example.com/socken");
      await form.getByLabel("Ungefährer Preis in €").fill("24,90");
      await form.getByLabel("Notiz").fill("Größe 42, grau");
      await saveDetails(page);

      await expect(page).toHaveURL(/\/wuensche$/);
      const item = page.getByTestId("wish-item").filter({
        hasText: "Wollsocken",
      });
      await expect(item).toBeVisible();
      await expect(item).toContainText("ca. 24,90");
      await expect(item).toContainText("Größe 42, grau");
      const link = item.getByRole("link", { name: /example\.com/ });
      await expect(link).toHaveAttribute("href", "https://example.com/socken");
      await expect(link).toHaveAttribute("rel", /noopener/);

      // Survives a reload (persisted, not just client state).
      await page.reload();
      await expect(page.getByTestId("wish-item")).toHaveCount(1);

      // Archive.
      await page
        .getByTestId("wish-item")
        .getByRole("button", { name: "Als erhalten markieren" })
        .click();
      await expect(page.getByTestId("wish-empty")).toBeVisible();
      await expect(page.getByTestId("wish-tab-open")).toContainText("(0)");
      await page.getByTestId("wish-tab-received").click();
      await expect(page).toHaveURL(/status=archiv/);
      const archived = page.getByTestId("wish-item");
      await expect(archived).toContainText("Wollsocken");
      await expect(archived).toContainText("Erhalten am");

      // Reopen.
      await archived.getByRole("button", { name: "Wieder öffnen" }).click();
      await expect(page.getByTestId("wish-empty")).toContainText(
        "Noch nichts im Archiv",
      );
      await page.getByTestId("wish-tab-open").click();
      await expect(page.getByTestId("wish-item")).toContainText("Wollsocken");

      // Edit from the list.
      await page.getByRole("link", { name: "Bearbeiten" }).click();
      await expect(page).toHaveURL(/edit=/);
      const editForm = page.getByTestId("wish-edit-form");
      await editForm.getByLabel("Titel").fill("Dicke Wollsocken");
      await saveDetails(page);
      await expect(page.getByTestId("wish-item")).toContainText(
        "Dicke Wollsocken",
      );

      // Delete with confirm panel; cancel first.
      await page.getByRole("button", { name: "Löschen" }).click();
      await page.getByRole("button", { name: "Abbrechen" }).click();
      await expect(page.getByTestId("wish-item")).toHaveCount(1);
      await page.getByRole("button", { name: "Löschen" }).click();
      await page.getByRole("button", { name: "Endgültig löschen" }).click();
      await expect(page.getByTestId("wish-empty")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("text search filters the list and can be reset", async ({ browser }) => {
    const { ctx } = await createFreshAuthedContext(browser, {
      withProfile: true,
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/wuensche");
      await quickAdd(page, "Kerze");
      await page.goto("/wuensche");
      await quickAdd(page, "Buch über Äpfel");
      await page.goto("/wuensche");
      await expect(page.getByTestId("wish-item")).toHaveCount(2);

      await page.getByRole("searchbox", { name: "Suche" }).fill("äpfel");
      await page.getByRole("button", { name: "Filtern" }).click();
      await expect(page).toHaveURL(/q=/);
      await expect(page.getByTestId("wish-item")).toHaveCount(1);
      await expect(page.getByTestId("wish-item")).toContainText("Buch");

      await page.getByRole("searchbox", { name: "Suche" }).fill("zzz");
      await page.getByRole("button", { name: "Filtern" }).click();
      await expect(page.getByTestId("wish-empty")).toContainText(
        "Keine Wünsche passen",
      );

      await page.getByRole("link", { name: "Zurücksetzen" }).click();
      await expect(page.getByTestId("wish-item")).toHaveCount(2);
    } finally {
      await ctx.close();
    }
  });
});

const GROUP_LABEL = `Wunschgruppe E2E (${new Date().getFullYear()})`;

test.describe("wishes: groups", () => {
  test("assign own group, filter by group / unassigned; group select only lists own groups", async ({
    browser,
  }) => {
    const { ctx } = await createFreshAuthedContext(browser);
    const page = await ctx.newPage();
    try {
      // Fresh user: profile is created with the first group.
      await page.goto("/gruppen/neu");
      await page.locator("#firstName").fill("Wunsch");
      await page.locator("#lastName").fill("Tester");
      await page.locator("#name").fill("Wunschgruppe E2E");
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/gruppen\/(?!neu$)[^/]+$/, {
        timeout: 15_000,
      });

      await page.goto("/wuensche");
      await quickAdd(page, "Mit Gruppe");
      const form = page.getByTestId("wish-edit-form");
      const select = form.getByLabel("Gruppe");
      await expect(select.locator("option")).toHaveText([
        "Keiner Gruppe zugeordnet",
        GROUP_LABEL,
      ]);
      await select.selectOption({ label: GROUP_LABEL });
      await saveDetails(page);
      await expect(page.getByTestId("wish-item")).toContainText(
        "Wunschgruppe E2E",
      );

      await page.goto("/wuensche");
      await quickAdd(page, "Ohne Gruppe");
      await saveDetails(page);
      await expect(page.getByTestId("wish-item")).toHaveCount(2);

      await page.getByLabel("Gruppe", { exact: true }).selectOption("none");
      await page.getByRole("button", { name: "Filtern" }).click();
      await expect(page.getByTestId("wish-item")).toHaveCount(1);
      await expect(page.getByTestId("wish-item")).toContainText("Ohne Gruppe");

      await page
        .getByLabel("Gruppe", { exact: true })
        .selectOption({ label: GROUP_LABEL });
      await page.getByRole("button", { name: "Filtern" }).click();
      await expect(page.getByTestId("wish-item")).toHaveCount(1);
      await expect(page.getByTestId("wish-item")).toContainText("Mit Gruppe");
    } finally {
      await ctx.close();
    }
  });
});

test.describe("wishes: validation + isolation", () => {
  test("invalid link and price show errors, nothing is saved", async ({
    browser,
  }) => {
    const { ctx } = await createFreshAuthedContext(browser, {
      withProfile: true,
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/wuensche");
      await quickAdd(page, "Fehlertest");
      const form = page.getByTestId("wish-edit-form");

      await form.getByLabel("Link").fill("javascript:alert(1)");
      await saveDetails(page);
      await expect(form.getByRole("alert")).toContainText(
        "gültigen Link mit http:// oder https://",
      );
      await expect(form.getByLabel("Link")).toHaveAttribute(
        "aria-invalid",
        "true",
      );

      // The form resets to submitted values once the action settles; reload
      // so a late reset cannot overwrite the next fill().
      await page.reload();
      await form.getByLabel("Ungefährer Preis in €").fill("viel");
      await saveDetails(page);
      await expect(form.getByRole("alert")).toContainText("Preis als Zahl");

      await page.reload();
      await form.getByLabel("Titel").fill("x".repeat(201));
      await saveDetails(page);
      // fill() bypasses maxLength, so the server-side cap is what answers.
      await expect(form.getByRole("alert")).toContainText(
        "Maximal 200 Zeichen",
      );
      await expect(page).toHaveURL(/edit=/);
    } finally {
      await ctx.close();
    }
  });

  test("another user never sees my wishes", async ({ browser }) => {
    const mine = await createFreshAuthedContext(browser, {
      withProfile: true,
    });
    const theirs = await createFreshAuthedContext(browser, {
      withProfile: true,
    });
    const myPage = await mine.ctx.newPage();
    const theirPage = await theirs.ctx.newPage();
    try {
      await myPage.goto("/wuensche");
      await quickAdd(myPage, "Mein Geheimwunsch");

      await theirPage.goto("/wuensche");
      await expect(theirPage.getByTestId("wish-empty")).toBeVisible();
      await expect(theirPage.getByText("Mein Geheimwunsch")).toHaveCount(0);

      // Forged edit id of someone else's wish: no form, nothing leaks.
      const editId = new URL(myPage.url()).searchParams.get("edit")!;
      await theirPage.goto(`/wuensche?edit=${editId}`);
      await expect(theirPage.getByTestId("wish-edit-form")).toHaveCount(0);
      await expect(theirPage.getByText("Mein Geheimwunsch")).toHaveCount(0);
    } finally {
      await mine.ctx.close();
      await theirs.ctx.close();
    }
  });
});
