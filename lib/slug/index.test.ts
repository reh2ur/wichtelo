import { describe, it, expect } from "vitest";
import { generateSlug, slugCandidate } from ".";

describe("generateSlug", () => {
  describe("umlaut transliteration", () => {
    it("transliterates ä/Ä to ae", () => {
      expect(generateSlug("Wählen", [])).toBe("waehlen");
      expect(generateSlug("Ärger", [])).toBe("aerger");
    });
    it("transliterates ö/Ö to oe", () => {
      expect(generateSlug("Öko", [])).toBe("oeko");
      expect(generateSlug("schön", [])).toBe("schoen");
    });
    it("transliterates ü/Ü to ue", () => {
      expect(generateSlug("Über", [])).toBe("ueber");
      expect(generateSlug("Grüße", [])).toBe("gruesse");
    });
    it("transliterates ß to ss", () => {
      expect(generateSlug("Straße", [])).toBe("strasse");
    });
    it("strips non-German diacritics instead of splitting the word", () => {
      expect(generateSlug("Dogfood Testgruppe Ünïcöde äöü ß", [])).toBe(
        "dogfood-testgruppe-uenicoede-aeoeue-ss",
      );
    });
  });

  describe("slug normalization", () => {
    it("lowercases the result", () => {
      expect(generateSlug("Secret Santa", [])).toBe("secret-santa");
    });
    it("replaces spaces and special chars with hyphens", () => {
      expect(generateSlug("Secret Santa 2024", [])).toBe("secret-santa-2024");
    });
    it("collapses consecutive separators into a single hyphen", () => {
      expect(generateSlug("a  b---c", [])).toBe("a-b-c");
    });
    it("strips leading and trailing hyphens", () => {
      expect(generateSlug("  hello world  ", [])).toBe("hello-world");
      expect(generateSlug("---test---", [])).toBe("test");
    });
  });

  describe("empty / degenerate names", () => {
    it('falls back to "gruppe" for empty string', () => {
      expect(generateSlug("", [])).toBe("gruppe");
    });
    it('falls back to "gruppe" for whitespace-only string', () => {
      expect(generateSlug("   ", [])).toBe("gruppe");
    });
    it('falls back to "gruppe" when only special chars remain', () => {
      expect(generateSlug("!!!", [])).toBe("gruppe");
    });
    it('falls back to "gruppe" for pure-umlaut input that empties after transliteration if no alpha remains', () => {
      expect(generateSlug("---", [])).toBe("gruppe");
    });
  });

  describe("collision resolution", () => {
    it("returns base slug when no collision", () => {
      expect(generateSlug("test", ["other"])).toBe("test");
      expect(generateSlug("test", [])).toBe("test");
    });
    it("appends -2 on first collision", () => {
      expect(generateSlug("test", ["test"])).toBe("test-2");
    });
    it("increments suffix until free", () => {
      expect(generateSlug("test", ["test", "test-2"])).toBe("test-3");
      expect(generateSlug("test", ["test", "test-2", "test-3"])).toBe("test-4");
    });
    it("does not skip suffixes", () => {
      expect(generateSlug("test", ["test", "test-3"])).toBe("test-2");
    });
    it('handles "gruppe" fallback collisions', () => {
      expect(generateSlug("!!!", ["gruppe"])).toBe("gruppe-2");
    });
  });
});

describe("slugCandidate (#175)", () => {
  it("uses readable sequential suffixes first", () => {
    expect(slugCandidate("Familie", 0)).toBe("familie");
    expect(slugCandidate("Familie", 1)).toBe("familie-2");
    expect(slugCandidate("Familie", 4)).toBe("familie-5");
  });

  it("falls back to a 4-char base36 suffix after the sequential ones", () => {
    expect(slugCandidate("Familie", 5, () => 0.5)).toBe("familie-iiii");
  });

  it("never runs out of valid slugs", () => {
    for (let n = 5; n < 1000; n++) {
      expect(slugCandidate("Büro", n)).toMatch(/^buero-[a-z0-9]{4}$/);
    }
  });
});
