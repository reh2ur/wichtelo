import { fetchHtml, type FetchHtmlOptions } from "./fetch";
import { parseLinkPreview, type LinkPreview } from "./parse";

export type LinkPreviewResult =
  { ok: true; preview: LinkPreview } | { ok: false; reason: string };

/** Fetches `url` (SSRF-hardened) and extracts title / image / price. */
export async function loadLinkPreview(
  url: string,
  options?: FetchHtmlOptions,
): Promise<LinkPreviewResult> {
  const page = await fetchHtml(url, options);
  if (!page.ok) return { ok: false, reason: page.reason };
  const preview = parseLinkPreview(page.html, page.finalUrl);
  if (!preview.title && !preview.imageUrl && !preview.price) {
    return { ok: false, reason: "empty" };
  }
  return { ok: true, preview };
}
