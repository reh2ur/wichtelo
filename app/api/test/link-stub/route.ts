import { NextResponse } from "next/server";
import { isTestBackdoorEnabled } from "@/lib/test-backdoor";

/**
 * E2E only: stands in for a shop product page so the link-preview spec never
 * hits a real shop. `?mode=product` serves OG + JSON-LD, `?mode=json` a
 * non-HTML response, anything else a bare page without metadata.
 *
 * The caller is our own server-side link fetch, which cannot send custom
 * headers, so the E2E secret travels as `?s=` and is fed to the same gate.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gate = new Headers({ "x-e2e-secret": searchParams.get("s") ?? "" });
  if (!isTestBackdoorEnabled(gate)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const mode = searchParams.get("mode");
  if (mode === "json") return NextResponse.json({ not: "html" });

  const html =
    mode === "product"
      ? `<!doctype html><html><head><title>Stub</title>
<meta property="og:title" content="Stub Kaffeemühle">
<meta property="og:image" content="https://stub-cdn.invalid/mill.jpg">
<script type="application/ld+json">{"@type":"Product","name":"Stub Kaffeemühle","offers":{"@type":"Offer","price":"39.90","priceCurrency":"EUR"}}</script>
</head><body>Stub</body></html>`
      : "<!doctype html><html><head></head><body>Nothing here</body></html>";
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
