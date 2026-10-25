const PAGE_SIZE = 1000;

/**
 * Reads every row of a query by walking `.range()` windows. PostgREST caps a
 * single response at `max_rows` (1000, `supabase/config.toml`) and truncates
 * silently, so an unbounded `select` returns wrong counts once a table grows
 * past that. Throws on any DB error.
 *
 * `fetchPage` must apply a stable `.order()` so windows do not overlap.
 */
export async function fetchAllRows<T>(
  label: string,
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error)
      throw new Error(`[${label}] range ${from} failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
