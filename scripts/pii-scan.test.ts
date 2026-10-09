import { describe, expect, it } from "vitest";
import {
  genericRules,
  isExcluded,
  privateRules,
  scanContent,
} from "./pii-scan.mts";

describe("pii-scan", () => {
  it("flags secret-shaped strings with file:line", () => {
    const v = scanContent(
      "a.ts",
      `ok\nconst k = "re_${"a".repeat(24)}";`,
      genericRules,
    );
    expect(v).toEqual([{ file: "a.ts", line: 2, rule: "Resend API key" }]);
  });

  it("flags concrete vercel team slugs but not placeholders", () => {
    expect(
      scanContent(
        "a",
        "https://x-*-someteam-projects.vercel.app/**",
        genericRules,
      ),
    ).toHaveLength(1);
    expect(
      scanContent(
        "a",
        "https://x-*-<your-vercel-team>-projects.vercel.app",
        genericRules,
      ),
    ).toHaveLength(0);
  });

  it("matches private terms case-insensitively as literals", () => {
    const rules = privateRules("# comment\n\nJane Doe\nexample.test (x)\n");
    expect(scanContent("a", "by jane doe", rules)).toHaveLength(1);
    expect(scanContent("a", "example.test (x)", rules)).toHaveLength(1);
    expect(scanContent("a", "exampleXtest", rules)).toHaveLength(0);
  });

  it("does not leak matched text", () => {
    const [v] = scanContent("a", "Jane Doe", privateRules("Jane Doe"));
    expect(JSON.stringify(v)).not.toContain("Jane");
  });

  it("excludes lockfile and scanner files", () => {
    expect(isExcluded("pnpm-lock.yaml")).toBe(true);
    expect(isExcluded("lib/env.ts")).toBe(false);
  });
});
