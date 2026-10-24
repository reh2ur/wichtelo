import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { colors } from "../emails/components/theme";

// Guards the hand-written Go-template auth mails (Supabase Auth sends them, not
// Resend) against drift from the React Email layout and from config.toml.
// See CLAUDE.md (Stack > Resend) and docs/security.md.

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const config = read("supabase/config.toml");
const layoutSource = read("emails/components/wichtel-layout.tsx");

// Active (uncommented) template blocks wired in config.toml.
const wired = [
  ...config.matchAll(
    /^\[auth\.email\.template\.(\w+)\]\s*\n(?:^(?!\[).*\n)*?^content_path = "\.\/([^"]+)"/gm,
  ),
].map(([, name, path]) => ({ name, path }));

const otpExpirySeconds = Number(
  config.match(/^otp_expiry = (\d+)/m)?.[1] ?? Number.NaN,
);

// Whitespace-normalised: prettier wraps the prose over several lines.
const flat = (html: string) => html.replace(/\s+/g, " ");

const ALLOWED_PLACEHOLDERS = [
  ".Token",
  ".TokenHash",
  ".RedirectTo",
  ".SiteURL",
] as const;

// Hexes allowed in the mail besides theme.ts colors: layout header text and
// button label colour (both inline literals in the React Email sources).
const EXTRA_HEXES = ["#ffffff", "#fffaf9"];

// Theme colours the shared layout (plus the crimson CTA button) renders with.
const requiredColors = [
  ...new Set([
    ...[...layoutSource.matchAll(/colors\.(\w+)/g)].map((m) => m[1]),
    "crimson",
  ]),
] as Array<keyof typeof colors>;

describe("supabase config.toml wiring", () => {
  it("wires magic_link and confirmation templates", () => {
    expect(wired.map((w) => w.name).sort()).toEqual([
      "confirmation",
      "magic_link",
    ]);
  });

  it("has a numeric otp_expiry", () => {
    expect(Number.isFinite(otpExpirySeconds)).toBe(true);
    expect(otpExpirySeconds % 60).toBe(0);
  });
});

describe.each(wired)("supabase auth template $name", ({ path }) => {
  const html = read(path);
  const text = flat(html);

  it("button links to the app confirm page with token_hash, never ConfirmationURL", () => {
    expect(html).not.toContain("ConfirmationURL");
    expect(html).toContain(
      'href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email"',
    );
  });

  it("only uses known Go placeholders (typos break login mail silently)", () => {
    const used = [...html.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1].trim());
    expect(used.length).toBeGreaterThan(0);
    for (const placeholder of used) {
      expect(ALLOWED_PLACEHOLDERS as readonly string[]).toContain(placeholder);
    }
    for (const required of ALLOWED_PLACEHOLDERS) {
      expect(used).toContain(required);
    }
    // No unbalanced braces left over.
    expect(html.replace(/\{\{[^}]*\}\}/g, "")).not.toMatch(/[{}]/);
  });

  it("states the OTP lifetime configured in config.toml", () => {
    const minutes = otpExpirySeconds / 60;
    expect(text).toContain(`Der Code ist ${minutes} Minuten gültig`);
    const stated = [...text.matchAll(/(\d+) Minuten/g)].map((m) =>
      Number(m[1]),
    );
    expect(stated).toEqual([minutes]);
  });

  it("carries the Impressum + Datenschutz footer like wichtel-layout.tsx", () => {
    expect(html).toContain('href="{{ .SiteURL }}/impressum"');
    expect(html).toContain('href="{{ .SiteURL }}/datenschutz"');
    expect(text).toMatch(/>\s*Impressum\s*</);
    expect(text).toMatch(/>\s*Datenschutz\s*</);
    expect(text).toContain(
      "Diese E-Mail wurde automatisch von Wichtelo versendet.",
    );
    expect(layoutSource).toContain(
      "Diese E-Mail wurde automatisch von Wichtelo versendet.",
    );
    expect(layoutSource).toContain("/impressum");
    expect(layoutSource).toContain("/datenschutz");
  });

  it("mirrors the theme.ts palette", () => {
    const used = new Set(
      [...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()),
    );
    const known = new Set(
      [...Object.values(colors), ...EXTRA_HEXES].map((h) => h.toLowerCase()),
    );

    // Every hex in the mail is a theme colour (catches a stale/changed hex)...
    for (const hex of used) expect(known).toContain(hex);
    // ...and every colour the layout uses is present (catches a theme change).
    for (const key of requiredColors) {
      expect(used, `theme colour ${key}`).toContain(colors[key].toLowerCase());
    }
  });

  it("is German, single-document HTML", () => {
    expect(html).toContain('<html lang="de">');
    expect(html.match(/<html/g)).toHaveLength(1);
  });
});
