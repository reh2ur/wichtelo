import { describe, it, expect } from "vitest";
import { colors } from "./theme";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("email theme contrast (WCAG AA 4.5:1)", () => {
  const pairs: [string, string, string][] = [
    ["muted on background box", colors.muted, colors.background],
    ["muted on card", colors.muted, colors.card],
    ["foreground on background", colors.foreground, colors.background],
    ["CTA text on CTA background", colors.ctaText, colors.ctaBackground],
  ];
  it.each(pairs)("%s", (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
