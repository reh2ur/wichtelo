import type { createClient } from "@/lib/supabase/server";

type UserClient = Awaited<ReturnType<typeof createClient>>;

export interface Wish {
  id: string;
  title: string;
  url: string | null;
  note: string | null;
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
      "id, title, url, note, price_estimate, group_id, status, received_at, created_at",
    )
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[loadWishes] failed: ${error.message}`);
  return data ?? [];
}
