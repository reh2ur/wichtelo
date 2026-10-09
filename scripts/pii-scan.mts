export type Rule = {
  /** Shown in the failure message. */
  name: string;
  pattern: RegExp;
};

export type Violation = {
  file: string;
  line: number;
  rule: string;
};

/**
 * Committed rules: generic shapes only. Never put real names, addresses or
 * slugs here — that would leak them. Those go in the private denylist
 * (`PII_DENYLIST` env / `.pii-denylist` file), see `privateRules`.
 */
export const genericRules: Rule[] = [
  { name: "Stripe-style live key", pattern: /\b[sr]k_live_[A-Za-z0-9]{8,}/ },
  { name: "Resend API key", pattern: /\bre_[A-Za-z0-9]{20,}/ },
  { name: "Supabase access token", pattern: /\bsbp_[a-f0-9]{40}\b/ },
  { name: "Sentry auth token", pattern: /\bsntrys?_[A-Za-z0-9+/=_-]{20,}/ },
  { name: "Sentry DSN", pattern: /https:\/\/[a-f0-9]{16,}@[\w.-]*sentry\.io/ },
  {
    name: "JWT",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: "Private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: "Concrete Vercel team slug (use <your-vercel-team> placeholder)",
    pattern: /[a-z0-9]-projects\.vercel\.app/,
  },
];

/** Case-insensitive literal matches; blank lines and `#` comments ignored. */
export function privateRules(denylist: string): Rule[] {
  return denylist
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((term) => ({
      name: "Private denylist term",
      pattern: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    }));
}

export function scanContent(
  file: string,
  content: string,
  rules: Rule[],
): Violation[] {
  const violations: Violation[] = [];
  content.split("\n").forEach((text, i) => {
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        violations.push({ file, line: i + 1, rule: rule.name });
      }
    }
  });
  return violations;
}

/** Files never scanned: lockfile (hashes look like secrets) and the scanner itself. */
export function isExcluded(file: string): boolean {
  return (
    file === "pnpm-lock.yaml" ||
    file === "scripts/pii-scan.mts" ||
    file === "scripts/pii-scan.test.ts"
  );
}
