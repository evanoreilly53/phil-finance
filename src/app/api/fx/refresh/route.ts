import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FX_SOURCES, needsRefresh, parseFrankfurter } from '@/lib/fx'

// Daily FX: the free, keyless Frankfurter API (ECB reference rates).
// Called fire-and-forget by <FxRefresher /> when a household member opens the
// app; writes with that member's session, so RLS applies as usual. At most one
// fetch every 12 hours; a failure just leaves the last stored rate in place,
// and every page already falls back to that (or 1.65 for EUR). Nothing waits on it.

const SOURCE = 'frankfurter (ECB)'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ status: 'unauthenticated' }, { status: 401 })

  const [{ data: last }, { data: accounts }] = await Promise.all([
    supabase.from('fx_rates').select('fetched_at').eq('source', SOURCE).order('fetched_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('accounts').select('currency').eq('is_active', true),
  ])
  if (!needsRefresh(last?.fetched_at ?? null)) return NextResponse.json({ status: 'fresh' })

  const quotes = [...new Set(['EUR', ...(accounts ?? []).map(a => a.currency.toUpperCase())])]
    .filter(c => c !== 'AUD' && /^[A-Z]{3}$/.test(c))

  for (const url of FX_SOURCES) {
    try {
      const res = await fetch(url(quotes), { signal: AbortSignal.timeout(4000), cache: 'no-store' })
      if (!res.ok) continue
      const parsed = parseFrankfurter(await res.json())
      if (!parsed) continue
      const fetched_at = new Date().toISOString()
      const rows = Object.entries(parsed.audPer).map(([from_currency, rate]) => ({
        date: parsed.date, from_currency, to_currency: 'AUD', rate, source: SOURCE, fetched_at,
      }))
      const { error } = await supabase.from('fx_rates').upsert(rows, { onConflict: 'date,from_currency,to_currency' })
      if (error) return NextResponse.json({ status: 'error', error: error.message }, { status: 500 })
      return NextResponse.json({ status: 'updated', date: parsed.date, rates: parsed.audPer })
    } catch {
      // timeout / network / bad JSON: try the next source
    }
  }
  return NextResponse.json({ status: 'unavailable' }, { status: 502 })
}
