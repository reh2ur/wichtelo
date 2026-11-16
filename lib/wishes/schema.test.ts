import { describe, it, expect } from "vitest";
import { parseWishInput, WISH_LIMITS } from "./schema";

function ok(raw: Parameters<typeof parseWishInput>[0]) {
  const r = parseWishInput(raw);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function err(raw: Parameters<typeof parseWishInput>[0]) {
  const r = parseWishInput(raw);
  if (r.ok) throw new Error("expected error");
  return r.error;
}

describe("parseWishInput", () => {
  it("quick-add: title only, everything else null", () => {
    expect(ok({ title: "  Wollsocken " })).toEqual({
      title: "Wollsocken",
      url: null,
      note: null,
      priceEstimate: null,
      groupId: null,
    });
  });

  it("requires a title", () => {
    expect(err({ title: "   " })).toEqual({ field: "title", code: "required" });
    expect(err({})).toEqual({ field: "title", code: "required" });
  });

  it("caps title, note and url length", () => {
    expect(err({ title: "a".repeat(WISH_LIMITS.title + 1) })).toEqual({
      field: "title",
      code: "too_long",
      max: WISH_LIMITS.title,
    });
    expect(err({ title: "x", note: "n".repeat(WISH_LIMITS.note + 1) })).toEqual(
      { field: "note", code: "too_long", max: WISH_LIMITS.note },
    );
    expect(
      err({ title: "x", url: `https://a.de/${"p".repeat(WISH_LIMITS.url)}` }),
    ).toEqual({ field: "url", code: "too_long", max: WISH_LIMITS.url });
    expect(ok({ title: "a".repeat(WISH_LIMITS.title) }).title).toHaveLength(
      WISH_LIMITS.title,
    );
  });

  describe("url", () => {
    it("accepts http and https", () => {
      expect(ok({ title: "x", url: "http://a.de/x?y=1" }).url).toBe(
        "http://a.de/x?y=1",
      );
      expect(ok({ title: "x", url: "https://a.de" }).url).toBe("https://a.de");
    });

    it("prepends https:// to a bare host", () => {
      expect(ok({ title: "x", url: "example.com/buch" }).url).toBe(
        "https://example.com/buch",
      );
    });

    it.each([
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "ftp://a.de/file",
      "file:///etc/passwd",
      "https://",
      "https://a b.de",
    ])("rejects %s", (url) => {
      expect(err({ title: "x", url })).toEqual({
        field: "url",
        code: "invalid_url",
      });
    });

    it("treats blank as no link", () => {
      expect(ok({ title: "x", url: "  " }).url).toBeNull();
    });
  });

  describe("price", () => {
    it.each([
      ["25", 25],
      ["24,90", 24.9],
      ["24.9", 24.9],
      [" 0 ", 0],
      ["99999,99", 99999.99],
    ])("parses %s", (price, expected) => {
      expect(ok({ title: "x", price }).priceEstimate).toBe(expected);
    });

    it.each(["abc", "-5", "1.234,56", "12,345", "100000", "1e3", "NaN"])(
      "rejects %s",
      (price) => {
        expect(err({ title: "x", price })).toEqual({
          field: "price",
          code: "invalid_price",
        });
      },
    );
  });

  describe("group", () => {
    it("accepts a uuid", () => {
      const groupId = "6f1b0a3e-9c1c-4d6a-8f55-1d3c2b7a9e10";
      expect(ok({ title: "x", groupId }).groupId).toBe(groupId);
    });

    it("rejects non-uuid input", () => {
      expect(err({ title: "x", groupId: "not-a-uuid" })).toEqual({
        field: "group",
        code: "invalid_group",
      });
    });

    it("blank = unassigned", () => {
      expect(ok({ title: "x", groupId: "" }).groupId).toBeNull();
    });
  });
});
