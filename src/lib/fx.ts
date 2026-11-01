// FX: parse the free Frankfurter (ECB) API and pick a safe rate. Pure.
// Rates are stored as AUD per 1 unit of foreign currency (aud = native × rate),
// the convention used everywhere else in the app.

export const FX_SOURCES = [
  // v1: { amount, base, date, rates: { EUR: 0.6287 } }
  (quotes: string[]) => `https://api.frankfurter.dev/v1/latest?base=AUD&symbols=${quotes.join(',')}`,
  // v2: [{ date, base, quote, rate }]
  (quotes: string[]) => `https://api.frankfurter.dev/v2/rates?base=AUD&quotes=${quotes.join(',')}`,
] as const

export const FALLBACK_RATES: Readonly<Record<string, number>> = { EUR: 1.65 }

export type ParsedRates = { date: string; audPer: Record<string, number> }

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** Accepts either Frankfurter response shape with base=AUD; returns AUD per unit. */
export function parseFrankfurter(json: unknown): ParsedRates | null {
  const audPer: Record<string, number> = {}
  let date: string | null = null
  const add = (cur: unknown, perAud: unknown) => {
    if (typeof cur !== 'string' || !/^[A-Z]{3}$/.test(cur)) return
    if (typeof perAud !== 'number' || !Number.isFinite(perAud) || perAud <= 0) return
    audPer[cur] = round6(1 / perAud)
  }
  const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)

  if (Array.isArray(json)) {
    for (const r of json) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      if (o.base !== 'AUD') continue
      if (isDate(o.date) && (!date || o.date > date)) date = o.date
      add(o.quote, o.rate)
    }
  } else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (o.base !== 'AUD' || !isDate(o.date) || !o.rates || typeof o.rates !== 'object') return null
    date = o.date
    for (const [cur, v] of Object.entries(o.rates as Record<string, unknown>)) add(cur, v)
  }
  if (!date || Object.keys(audPer).length === 0) return null
  return { date, audPer }
}

/** Refresh at most every `hours` (default 12). ECB publishes once per working day. */
export function needsRefresh(lastFetchedAt: string | null, now: Date = new Date(), hours = 12): boolean {
  if (!lastFetchedAt) return true
  const t = Date.parse(lastFetchedAt)
  return !Number.isFinite(t) || now.getTime() - t > hours * 3_600_000
}

export type RateChoice = { rate: number; date: string | null; source: 'stored' | 'fallback' }

/** Latest stored rate if there is one, else the fallback. Never throws, never blocks. */
export function chooseRate(currency: string, stored: { rate: number | string; date: string } | null | undefined): RateChoice | null {
  const n = stored ? Number(stored.rate) : NaN
  if (stored && Number.isFinite(n) && n > 0) return { rate: n, date: stored.date, source: 'stored' }
  const fb = FALLBACK_RATES[currency.toUpperCase()]
  return fb ? { rate: fb, date: null, source: 'fallback' } : null
}
