// Fails when a tracked file matches the PII / secret denylist.
// Private terms (real name, address, old slugs) come from env `PII_DENYLIST`
// (newline-separated; CI repo variable) or a gitignored `.pii-denylist` file,
// so they are never committed. Generic secret shapes live in `pii-scan.mts`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  genericRules,
  isExcluded,
  privateRules,
  scanContent,
  type Rule,
  type Violation,
} from "./pii-scan.mts";

const privateTerms = [
  process.env.PII_DENYLIST ?? "",
  existsSync(".pii-denylist") ? readFileSync(".pii-denylist", "utf8") : "",
].join("\n");

const rules: Rule[] = [...genericRules, ...privateRules(privateTerms)];
const hasPrivate = rules.length > genericRules.length;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f && !isExcluded(f) && existsSync(f));

const violations: Violation[] = [];
for (const file of files) {
  const buf = readFileSync(file);
  if (buf.includes(0)) continue; // binary
  violations.push(...scanContent(file, buf.toString("utf8"), rules));
}

if (!hasPrivate) {
  console.warn(
    "::notice::No private denylist (PII_DENYLIST / .pii-denylist) — only generic secret patterns checked.",
  );
}

if (violations.length > 0) {
  for (const v of violations) {
    // Rule name only, never the matched text: CI logs may be public.
    console.error(
      `::error file=${v.file},line=${v.line}::${v.rule} — remove it or move to env (see docs/security.md)`,
    );
    console.error(`${v.file}:${v.line}: ${v.rule}`);
  }
  console.error(`\n${violations.length} violation(s). See docs/security.md.`);
  process.exit(1);
}

console.log(`check-no-pii: ${files.length} files clean.`);
