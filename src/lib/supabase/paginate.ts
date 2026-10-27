/**
 * The Supabase Data API returns at most 1000 rows per request (max_rows).
 * Use this to read larger result sets page by page.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max = 50_000,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await page(from, Math.min(from + pageSize, max) - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
