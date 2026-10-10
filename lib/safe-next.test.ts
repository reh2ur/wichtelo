import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each([
    ["/gruppen/familie-2026", "/gruppen/familie-2026"],
    ["/gruppen/x?a=1#h", "/gruppen/x?a=1#h"],
    ["/", "/"],
  ])("accepts %s", (input, out) => {
    expect(safeNext(input)).toBe(out);
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "gruppen/x",
    "",
    "/a\nb",
    "/a\tb",
    "/" + "a".repeat(3000),
  ])("rejects %j", (input) => {
    expect(safeNext(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(["/a"])).toBeNull();
  });
});
