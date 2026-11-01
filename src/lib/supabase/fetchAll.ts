// PostgREST (Supabase) silently caps every response at `max-rows` (1,000 by
// default). Any query that can return more than that must page through with
// .range(). Pass a factory that builds the query for a given [from, to] window.
// It MUST include a deterministic .order() (end with a unique tiebreaker such
// as `id`) so pages neither overlap nor skip rows.

export const PAGE_SIZE = 1000
const MAX_PAGES = 200 // 200k rows: a safety stop, not an expected limit

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * pageSize
    const { data, error } = await page(from, from + pageSize - 1)
    // Fail loudly: a partial result would show the user wrong totals.
    if (error) throw new Error(`Failed to load data: ${error.message}`)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
  throw new Error(`fetchAll: exceeded ${MAX_PAGES} pages`)
}
