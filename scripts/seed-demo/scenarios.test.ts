import { describe, expect, it } from "vitest";
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_GROUPS,
  DEMO_SLUG_PREFIX,
  DEMO_USERS,
  DEMO_WISHES,
} from "./scenarios.mts";

describe("demo scenarios", () => {
  const aliases = new Set(DEMO_USERS.map((u) => u.alias));

  it("uses unique, reserved-domain emails", () => {
    const emails = DEMO_USERS.map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const e of emails)
      expect(e.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
  });

  it("prefixes every group slug and keeps members known + unique", () => {
    for (const g of DEMO_GROUPS) {
      expect(g.slug.startsWith(DEMO_SLUG_PREFIX)).toBe(true);
      expect(g.slug).toMatch(/^[a-z0-9-]{1,120}$/);
      expect(g.members.length).toBeGreaterThanOrEqual(3); // draw minimum
      expect(new Set(g.members).size).toBe(g.members.length);
      for (const m of g.members) expect(aliases.has(m)).toBe(true);
    }
    expect(new Set(DEMO_GROUPS.map((g) => g.slug)).size).toBe(
      DEMO_GROUPS.length,
    );
  });

  it("covers open + drawn groups and users without group", () => {
    expect(DEMO_GROUPS.map((g) => g.state).sort()).toEqual(["drawn", "open"]);
    const inGroup = new Set(DEMO_GROUPS.flatMap((g) => g.members));
    expect(DEMO_USERS.some((u) => !inGroup.has(u.alias))).toBe(true);
  });

  it("only links wishes to groups the owner belongs to", () => {
    for (const wish of DEMO_WISHES) {
      expect(aliases.has(wish.owner)).toBe(true);
      if (wish.group) {
        const g = DEMO_GROUPS.find((x) => x.slug === wish.group);
        expect(g?.members).toContain(wish.owner);
      }
    }
  });

  it("respects wish limits (title, note, price, 500 cap)", () => {
    const perOwner = new Map<string, number>();
    for (const wish of DEMO_WISHES) {
      expect(wish.title.length).toBeGreaterThanOrEqual(1);
      expect(wish.title.length).toBeLessThanOrEqual(200);
      expect((wish.note ?? "").length).toBeLessThanOrEqual(1000);
      // Seed writes straight to the DB: CHECK wishes_url_format applies, no
      // parseWishInput normalisation (bare hosts would be rejected).
      if (wish.url !== null) {
        expect(wish.url).toMatch(/^https?:\/\/\S+$/);
        expect(wish.url.length).toBeLessThanOrEqual(2000);
      }
      if (wish.priceEstimate !== null) {
        expect(wish.priceEstimate).toBeGreaterThanOrEqual(0);
        expect(wish.priceEstimate).toBeLessThanOrEqual(99999.99);
      }
      perOwner.set(wish.owner, (perOwner.get(wish.owner) ?? 0) + 1);
    }
    for (const n of perOwner.values()) expect(n).toBeLessThanOrEqual(500);
    expect(perOwner.get("alice")).toBe(40);
  });

  it("has a user without wishes (empty state)", () => {
    const owners = new Set(DEMO_WISHES.map((x) => x.owner));
    expect(DEMO_USERS.some((u) => !owners.has(u.alias))).toBe(true);
  });
});
