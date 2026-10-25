import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors as emailColors } from "../emails/components/theme";

/**
 * WCAG AA contrast guard (issue #148). Parses real tokens + gradient stops out
 * of app/globals.css so a palette tweak that breaks AA fails here, not in prod.
 */

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

const root = join(__dirname, "..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite translucent `fg` over opaque `bg`. */
function over([r, g, b, a]: Rgba, bg: Rgb): Rgb {
  return [r, g, b].map((v, i) => Math.round(v * a + bg[i] * (1 - a))) as Rgb;
}

function token(name: string): Rgb {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`token --${name} not found in globals.css`);
  return hexToRgb(m[1]);
}

const bodyBlock =
  css.match(/\nbody \{\s*background-image[\s\S]*?\n\}/)?.[0] ?? "";
const gradient =
  bodyBlock.match(/linear-gradient\(([\s\S]*?)\n\s*\)/)?.[1] ?? "";
const gradientStops = [...gradient.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) =>
  hexToRgb(m[0]),
);
const radial = [...bodyBlock.matchAll(/rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/g)]
  // skip the white highlight blob, it only lightens
  .filter((m) => !(m[1] === "255" && m[2] === "255" && m[3] === "255"))
  .map((m) => [+m[1], +m[2], +m[3], +m[4] / 100] as Rgba);
const htmlBg = hexToRgb(
  css.match(/\nhtml \{\s*background:\s*(#[0-9a-fA-F]{6});/)?.[1] ?? "#000000",
);

const darkest = (cs: Rgb[]) =>
  cs.reduce((d, c) => (luminance(c) < luminance(d) ? c : d));

// Every opaque color page text can sit on without a card behind it.
const bareBackgrounds: [string, Rgb][] = [
  ...gradientStops.map((c, i) => [`gradient stop ${i}`, c] as [string, Rgb]),
  ...radial.map(
    (c, i) =>
      [
        `radial tint ${i} over darkest stop`,
        over(c, darkest(gradientStops)),
      ] as [string, Rgb],
  ),
  ["html background", htmlBg],
];

// `.bg-card` = 60% white over whatever is behind it; worst case = darkest bare bg.
const worstBare = darkest(bareBackgrounds.map(([, c]) => c));
const card = over([255, 255, 255, 0.6], worstBare);
const white: Rgb = [255, 255, 255];
const ice = token("ice");

const navy = token("navy");
const navySoft = token("navy-soft");
const dangerText = token("danger-text");
const successText = token("success-text");
const crimson = token("crimson");
const success = token("success");

const AA = 4.5;

describe("gradient parse sanity", () => {
  it("finds the stops the guard depends on", () => {
    expect(gradientStops.length).toBeGreaterThanOrEqual(4);
    expect(radial.length).toBeGreaterThanOrEqual(1);
  });
});

describe("text on bare page background (gradient)", () => {
  // Pages without a card (invite, konto, settings...) put all four text
  // tokens straight on the gradient, so the darkest stop is the bar.
  it.each(bareBackgrounds)(
    "navy / navy-soft / danger / success on %s",
    (_n, bg) => {
      for (const fg of [navy, navySoft, dangerText, successText]) {
        expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
      }
    },
  );
});

describe("status text on surfaces", () => {
  const surfaces: [string, Rgb][] = [
    ["white", white],
    ["--ice", ice],
    ["bg-card over darkest gradient", card],
  ];
  it.each(surfaces)("navy / navy-soft / danger / success on %s", (_n, bg) => {
    for (const fg of [navy, navySoft, dangerText, successText]) {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("tinted fills (chips, destructive button/badge, admin initials)", () => {
  const tints: [string, Rgb, number, Rgb][] = [
    ["success-text on bg-success/10", successText, 0.1, success],
    ["danger-text on bg-crimson/10", dangerText, 0.1, crimson],
    ["danger-text on bg-crimson/15", dangerText, 0.15, crimson],
    ["danger-text on bg-destructive/10", dangerText, 0.1, crimson],
    ["danger-text on bg-destructive/5 panel", dangerText, 0.05, crimson],
  ];
  it.each(tints)("%s", (_n, fg, alpha, fill) => {
    for (const base of [card, white, ice]) {
      const bg = over([...fill, alpha], base);
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
    }
  });
  it("state chips / admin initials: status text on bg-white/70 over any bare background", () => {
    for (const [, bare] of bareBackgrounds) {
      const bg = over([255, 255, 255, 0.7], bare);
      expect(ratio(dangerText, bg)).toBeGreaterThanOrEqual(AA);
      expect(ratio(successText, bg)).toBeGreaterThanOrEqual(AA);
    }
  });
  it("navy-soft on bg-muted", () => {
    expect(ratio(navySoft, token("muted"))).toBeGreaterThanOrEqual(AA);
  });
});

describe("email theme", () => {
  const hex = (h: string) => hexToRgb(h);
  it("muted text on email background and white card", () => {
    expect(
      ratio(hex(emailColors.muted), hex(emailColors.background)),
    ).toBeGreaterThanOrEqual(AA);
    expect(
      ratio(hex(emailColors.muted), hex(emailColors.card)),
    ).toBeGreaterThanOrEqual(AA);
  });
  it("auth mail templates use same muted color as email theme", () => {
    for (const f of ["magic_link.html", "confirmation.html"]) {
      const html = readFileSync(join(root, "supabase/templates", f), "utf8");
      const colorsUsed = [...html.matchAll(/color:\s*(#[0-9a-fA-F]{6})/g)].map(
        (m) => m[1].toLowerCase(),
      );
      expect(colorsUsed).toContain(emailColors.muted);
      expect(colorsUsed).not.toContain("#5d7793");
    }
  });
});

describe("no low-contrast text utilities (grep guard)", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }
  const files = [...walk(join(root, "app")), ...walk(join(root, "components"))];
  // text-crimson / text-success / text-destructive / text-primary (not -foreground)
  // and raw palette text colors. Fills/borders (bg-*, border-*) stay allowed.
  const forbidden =
    /(?<![\w-])(?:[\w-]+:)*text-(?:crimson|success|destructive|primary|emerald-\d+|red-\d+|green-\d+)(?![\w-])/;

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });
  it("no file uses forbidden text color utilities", () => {
    const offenders = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => (forbidden.test(line) ? `${f}:${i + 1}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(offenders).toEqual([]);
  });
});
