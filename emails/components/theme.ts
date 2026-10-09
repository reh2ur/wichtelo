// Hex approximations of the app's Glacier Mark design tokens (docs/design.md).
// Email clients need inline hex — OKLCH/CSS vars aren't reliable in HTML mail.
export const colors = {
  navy: "#16283f",
  navyDark: "#0d1a2b",
  crimson: "#df4a5e",
  crimsonText: "#c23a4d",
  success: "#1e8a5f",
  background: "#e3eef8",
  card: "#ffffff",
  foreground: "#16283f",
  muted: "#5d7793",
  border: "#c9dcee",
};

// Public origin for links inside emails (footer). Rendered outside a request,
// so it reads the canonical env var; localhost only in dev.
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const fontFamily =
  "'Manrope', 'Helvetica Neue', Helvetica, Arial, sans-serif";

export const text = {
  color: colors.foreground,
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 12px",
};

export const box = {
  backgroundColor: colors.background,
  border: `1px solid ${colors.border}`,
  borderRadius: "12px",
  padding: "16px 20px",
  margin: "0 0 20px",
};

export const muted = {
  color: colors.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 12px",
};
