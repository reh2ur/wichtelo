import type { createClient } from "@/lib/supabase/server";

type UserClient = Awaited<ReturnType<typeof createClient>>;

export interface Wish {
  id: string;
  title: string;
  url: string | null;
  note: string | null;
  link_title: string | null;
  link_image_url: string | null;
  link_brand: string | null;
  link_icon_url: string | null;
  price_estimate: number | null;
  group_id: string | null;
  status: "open" | "received";
  received_at: string | null;
  created_at: string;
}

/**
 * All wishes of `userId` (RLS-scoped user client), newest first. Throws on a
 * DB error — never `[]` — so a failure reaches `error.tsx` instead of showing
 * a false empty list. Capped at 500 per account by the DB, so one query is
 * enough and search/filter run in memory (`filterWishes`).
 */
export async function loadWishes(
  supabase: UserClient,
  userId: string,
): Promise<Wish[]> {
  const { data, error } = await supabase
    .from("wishes")
    .select(
      "id, title, url, note, link_title, link_image_url, link_brand, link_icon_url, price_estimate, group_id, status, received_at, created_at",
    )
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[loadWishes] failed: ${error.message}`);
  return data ?? [];
}

export type RecipientWish = Pick<
  Wish,
  "id" | "title" | "url" | "note" | "price_estimate"
>;

/**
 * Open wishes the viewer's recipient linked to `groupId` (#209). RLS
 * (`is_giver_of_wish`) already limits other people's wishes to the giver of
 * the owner in that group; `neq profile_id` drops the viewer's OWN wishes,
 * which the owner policy would also return. Throws on a DB error — never
 * `[]` — so a failure cannot read as "no wishes yet".
 */
export async function loadRecipientWishes(
  supabase: UserClient,
  groupId: string,
  viewerId: string,
): Promise<RecipientWish[]> {
  const { data, error } = await supabase
    .from("wishes")
    .select("id, title, url, note, price_estimate")
    .eq("group_id", groupId)
    .eq("status", "open")
    .neq("profile_id", viewerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[loadRecipientWishes] failed: ${error.message}`);
  return data ?? [];
}

/** Display host of a wish link (no `www.`); raw string if unparsable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
