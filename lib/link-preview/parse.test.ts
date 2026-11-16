import { describe, expect, it } from "vitest";
import { parseLinkPreview } from "./parse";

const BASE = "https://shop.example/produkt/1";
const ICON = "https://shop.example/favicon.ico";

const og = `<html><head>
<title>Fallback Title</title>
<meta property="og:title" content="Wollsocken &amp; Co">
<meta property="og:image" content="/img/socks.jpg">
<meta property="product:price:amount" content="24,90">
<meta property="product:price:currency" content="EUR">
</head></html>`;

const ld = (json: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(json)}</script>`;

describe("parseLinkPreview", () => {
  it("reads Open Graph only (entities decoded, relative image resolved)", () => {
    expect(parseLinkPreview(og, BASE)).toEqual({
      title: "Wollsocken & Co",
      imageUrl: "https://shop.example/img/socks.jpg",
      price: "24.90",
      brand: null,
      iconUrl: ICON,
    });
  });

  it("reads JSON-LD Product only", () => {
    const html = ld({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Kaffeemühle",
      image: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
      offers: { "@type": "Offer", price: "39.99", priceCurrency: "EUR" },
    });
    expect(parseLinkPreview(html, BASE)).toEqual({
      title: "Kaffeemühle",
      imageUrl: "https://cdn.example/a.jpg",
      price: "39.99",
      brand: null,
      iconUrl: ICON,
    });
  });

  it("prefers OG title/image, falls back to JSON-LD price when OG has none", () => {
    const html =
      `<meta property="og:title" content="OG Titel">` +
      `<meta property="og:image" content="https://cdn.example/og.jpg">` +
      ld({ "@type": "Product", name: "LD Name", offers: { price: 12 } });
    expect(parseLinkPreview(html, BASE)).toEqual({
      title: "OG Titel",
      imageUrl: "https://cdn.example/og.jpg",
      price: "12",
      brand: null,
      iconUrl: ICON,
    });
  });

  it("handles @graph, AggregateOffer and ImageObject", () => {
    const html = ld({
      "@graph": [
        { "@type": "WebSite", name: "Shop" },
        {
          "@type": ["Product", "Thing"],
          name: "Lampe",
          image: { "@type": "ImageObject", url: "https://cdn.example/l.png" },
          offers: {
            "@type": "AggregateOffer",
            lowPrice: "1.299,90",
            priceCurrency: "EUR",
          },
        },
      ],
    });
    expect(parseLinkPreview(html, BASE)).toEqual({
      title: "Lampe",
      imageUrl: "https://cdn.example/l.png",
      price: "1299.90",
      brand: null,
      iconUrl: ICON,
    });
  });

  it("handles offer arrays and nested priceSpecification", () => {
    const html = ld({
      "@type": "Product",
      name: "X",
      offers: [
        { "@type": "Offer", price: "5", priceCurrency: "USD" },
        {
          "@type": "Offer",
          priceSpecification: { price: "7.5", priceCurrency: "EUR" },
        },
      ],
    });
    expect(parseLinkPreview(html, BASE).price).toBe("7.5");
  });

  it("ignores non-euro prices", () => {
    const html = `<meta property="product:price:amount" content="10"><meta property="product:price:currency" content="USD">`;
    expect(parseLinkPreview(html, BASE).price).toBeNull();
  });

  it("falls back to <title>", () => {
    expect(parseLinkPreview("<title> Nur Titel </title>", BASE).title).toBe(
      "Nur Titel",
    );
  });

  it("survives malformed JSON-LD and garbage", () => {
    const html = `<script type="application/ld+json">{ not json</script><meta property="og:title" content="Ok">`;
    expect(parseLinkPreview(html, BASE).title).toBe("Ok");
    expect(parseLinkPreview("<<<>>><meta", BASE)).toEqual({
      title: null,
      imageUrl: null,
      price: null,
      brand: null,
      iconUrl: ICON,
    });
    expect(parseLinkPreview("", BASE)).toEqual({
      title: null,
      imageUrl: null,
      price: null,
      brand: null,
      iconUrl: ICON,
    });
  });

  it("rejects non-https / hostile image URLs", () => {
    for (const bad of [
      "http://cdn.example/a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:pw@cdn.example/a.jpg",
    ]) {
      const html = `<meta property="og:image" content="${bad}">`;
      expect(parseLinkPreview(html, BASE).imageUrl).toBeNull();
    }
  });

  it("treats title as plain text: strips controls, caps length", () => {
    const html = `<meta property="og:title" content="A&#10;B&#0;${"x".repeat(500)}">`;
    const { title } = parseLinkPreview(html, BASE);
    expect(title?.startsWith("A B")).toBe(true);
    expect(title?.length).toBeLessThanOrEqual(300);
    expect(title).not.toMatch(/[\u0000-\u001f]/);
  });

  it("does not render markup: keeps tags as literal text", () => {
    const html = `<meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;">`;
    expect(parseLinkPreview(html, BASE).title).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("rejects absurd prices", () => {
    const html = `<meta property="product:price:amount" content="9999999">`;
    expect(parseLinkPreview(html, BASE).price).toBeNull();
  });

  it("ignores bot-wall / error page titles", () => {
    for (const t of [
      "Just a moment...",
      "Vercel Security Checkpoint",
      "Attention Required! | Cloudflare",
      "Access Denied",
    ]) {
      expect(parseLinkPreview(`<title>${t}</title>`, BASE).title).toBeNull();
    }
    expect(parseLinkPreview("<title>Notizbuch A5</title>", BASE).title).toBe(
      "Notizbuch A5",
    );
  });

  it("cuts shop suffixes at the first spaced separator", () => {
    const t = (c: string) =>
      parseLinkPreview(`<meta property="og:title" content="${c}">`, BASE).title;
    expect(t("Herren Langarmshirt in Navy - €59.99 - DILLING")).toBe(
      "Herren Langarmshirt in Navy",
    );
    expect(t("NuPhy Air75 V2 | Low-Profile Keyboard")).toBe("NuPhy Air75 V2");
    expect(t("Lampe – Shop")).toBe("Lampe");
    // Unspaced hyphens stay; too-short heads fall back to the full title.
    expect(t("T-Shirt Merino")).toBe("T-Shirt Merino");
    expect(t("A | Sehr langer Produktname")).toBe(
      "A | Sehr langer Produktname",
    );
  });

  it("reads brand (og:site_name, else JSON-LD brand) and the page icon", () => {
    const html =
      `<meta property="og:site_name" content="DILLING">` +
      `<link rel="icon" href="/i16.png"><link rel="apple-touch-icon" href="/touch.png">`;
    expect(parseLinkPreview(html, BASE)).toMatchObject({
      brand: "DILLING",
      iconUrl: "https://shop.example/touch.png",
    });
    const ldHtml = ld({
      "@type": "Product",
      name: "X",
      brand: { name: "NuPhy" },
    });
    expect(parseLinkPreview(ldHtml, BASE).brand).toBe("NuPhy");
    expect(
      parseLinkPreview(
        `<link rel="shortcut icon" href="http://x.example/a.ico">`,
        BASE,
      ).iconUrl,
    ).toBe(ICON); // non-https icon rejected → origin favicon fallback
  });

  it("falls back to a price written into title / description", () => {
    const p = (head: string) => parseLinkPreview(head, BASE).price;
    expect(
      p(`<meta property="og:title" content="Shirt - €59.99 - DILLING">`),
    ).toBe("59.99");
    expect(
      p(`<meta name="description" content="Jetzt für 24,90 € sichern">`),
    ).toBe("24.90");
    expect(p(`<title>Kamera EUR 1.299,00</title>`)).toBe("1299.00");
    expect(p(`<title>Kein Preis hier</title>`)).toBeNull();
    // structured price still wins
    expect(
      p(
        `<meta property="og:title" content="X - €1"><meta property="product:price:amount" content="5">`,
      ),
    ).toBe("5");
  });
});
