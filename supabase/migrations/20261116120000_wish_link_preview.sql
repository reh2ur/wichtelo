-- Link preview metadata on wishes (issue #210, wishlist 3/3).
--
-- One-time prefill from the entered URL (Open Graph / JSON-LD): page title,
-- brand, site icon URL and image URL. The image is NOT stored, only hotlinked (https only). Both are
-- untrusted third-party text: length / format CHECKs mirror
-- lib/link-preview/sanitize.ts. Cleared by the app when the URL is cleared.

alter table public.wishes
  add column link_title text,
  add column link_image_url text,
  add column link_brand text,
  add column link_icon_url text,
  add constraint wishes_link_title_length check (
    link_title is null or char_length(link_title) between 1 and 300
  ),
  add constraint wishes_link_image_url_format check (
    link_image_url is null
    or (char_length(link_image_url) <= 2000 and link_image_url ~* '^https://[^[:space:]]+$')
  ),
  add constraint wishes_link_brand_length check (
    link_brand is null or char_length(link_brand) between 1 and 100
  ),
  add constraint wishes_link_icon_url_format check (
    link_icon_url is null
    or (char_length(link_icon_url) <= 2000 and link_icon_url ~* '^https://[^[:space:]]+$')
  ),
  -- Link metadata only makes sense next to a link.
  add constraint wishes_link_meta_needs_url check (
    url is not null or (
      link_title is null and link_image_url is null
      and link_brand is null and link_icon_url is null
    )
  );

grant update (link_title, link_image_url, link_brand, link_icon_url) on public.wishes to authenticated;
