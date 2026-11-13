type WishView = "open" | "received";

export interface WishFilter {
  view: WishView;
  /** Free-text search over title + note (case-insensitive). */
  q: string;
  /** `all`, `none` (unassigned) or a group id. */
  group: string;
}

export interface FilterableWish {
  title: string;
  note: string | null;
  group_id: string | null;
  status: WishView;
}

/** URL value of the archive view (`/wuensche?status=archiv`). */
export const ARCHIVE_PARAM = "archiv";

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

/** Defensive parse of `searchParams`; unknown values fall back to defaults. */
export function parseWishFilter(params: Record<string, Param>): WishFilter {
  return {
    view: first(params.status) === ARCHIVE_PARAM ? "received" : "open",
    q: (first(params.q) ?? "").trim().slice(0, 100),
    group: first(params.group)?.trim() || "all",
  };
}

export function hasActiveFilter(filter: WishFilter): boolean {
  return filter.q !== "" || filter.group !== "all";
}

export function filterWishes<T extends FilterableWish>(
  wishes: T[],
  filter: WishFilter,
): T[] {
  const needle = filter.q.toLocaleLowerCase("de");
  return wishes.filter((w) => {
    if (w.status !== filter.view) return false;
    if (filter.group === "none" && w.group_id !== null) return false;
    if (
      filter.group !== "all" &&
      filter.group !== "none" &&
      w.group_id !== filter.group
    ) {
      return false;
    }
    if (!needle) return true;
    return (
      w.title.toLocaleLowerCase("de").includes(needle) ||
      (w.note ?? "").toLocaleLowerCase("de").includes(needle)
    );
  });
}
