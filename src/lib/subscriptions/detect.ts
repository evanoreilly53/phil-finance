// Recurring-charge (subscription and bill) detection from transactions. Pure.
//
// 1. Merchant normalisation: the bank description is cleaned (card numbers,
//    value dates, reference codes, cities, "PTY LTD", ".COM" …) down to its
//    first one or two meaningful words: "NETFLIX.COM MELBOURNE AU" → NETFLIX.
// 2. Within a merchant, charges are split into amount clusters (Apple $2.99
//    and Apple $14.99 are two subscriptions), allowing a gradual price rise.
// 3. A cluster is recurring when its typical gap matches a cadence (weekly,
//    fortnightly, monthly, quarterly, annual), most gaps sit inside that
//    cadence's window (dates jitter with weekends and processing), and the
//    amount is steady charge to charge (so a weekly grocery shop with a
//    different total every week isn't a "subscription").
// 4. Price change: a steady price that moves to a new steady price.

import { normaliseDescription } from '../import/fingerprint'
import { dayDiff } from '../import/dates'
import { advanceDate } from '../plannedItems'

export type Cadence = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'

export type CadenceRule = { cadence: Cadence; minDays: number; maxDays: number; minCount: number; perYear: number }

export const CADENCES: readonly CadenceRule[] = [
  { cadence: 'weekly',      minDays: 6,   maxDays: 8,   minCount: 4, perYear: 52 },
  { cadence: 'fortnightly', minDays: 12,  maxDays: 16,  minCount: 4, perYear: 26 },
  { cadence: 'monthly',     minDays: 26,  maxDays: 35,  minCount: 3, perYear: 12 },
  { cadence: 'quarterly',   minDays: 80,  maxDays: 100, minCount: 3, perYear: 4 },
  { cadence: 'annual',      minDays: 350, maxDays: 380, minCount: 2, perYear: 1 },
]

/** Detection thresholds (documented in the Phase 4 report). */
export const DETECT = {
  /** Two charges belong to the same amount cluster if they're within this of each other (sorted by amount). */
  clusterGapPct: 0.15,
  clusterGapMinCents: 150,
  /** Share of gaps that must sit inside the cadence window. */
  regularShare: 0.6,
  /** Consecutive charges count as "steady" within max(8%, $1). Quarterly and annual bills skip this (utilities vary). */
  steadyPct: 0.08,
  steadyMinCents: 100,
  /** Share of consecutive charge pairs that must be steady. */
  steadyShare: 0.7,
  /** Same price = within 5c. A move of at least 50c between two steady prices is a price change. */
  samePriceCents: 5,
  priceChangeMinCents: 50,
  /** A price change is reported if the new price started within this many days. */
  priceChangeRecentDays: 120,
  /** A subscription is "new" if its first charge was within this many days. */
  newWithinDays: 120,
  /** Still active if the last charge was within 1.5 × the cadence's longest gap. */
  activeFactor: 1.5,
} as const

const NOISE = new Set([
  // payment-rail words
  'CARD', 'PURCHASE', 'DIRECT', 'DEBIT', 'DD', 'VISA', 'MASTERCARD', 'EFTPOS', 'POS', 'RECURRING', 'PAYMENT', 'PMT', 'AUTOPAY',
  'SUBSCRIPTION', 'SUBSCR', 'BILL', 'BILLING', 'MONTHLY', 'ANNUAL', 'INTL', 'INTERNATIONAL', 'TRANSACTION', 'FEE', 'VALUE', 'DATE',
  'REF', 'REFERENCE', 'XX', 'SP', 'SQ', 'TO', 'FROM', 'THE', 'AND', 'OF', 'FOR', 'ONLINE', 'APP', 'APPS', 'MOBILE',
  // company and web words
  'PTY', 'LTD', 'LIMITED', 'INC', 'LLC', 'CO', 'COM', 'WWW', 'HTTP', 'HTTPS', 'NET', 'ORG', 'IO',
  // places and country codes that trail CommBank descriptions
  'AU', 'AUS', 'AUSTRALIA', 'IE', 'IRL', 'IRELAND', 'NZ', 'US', 'USA', 'GB', 'UK', 'LU', 'NL', 'SG', 'SGP',
  'PERTH', 'SYDNEY', 'MELBOURNE', 'BRISBANE', 'ADELAIDE', 'HOBART', 'DARWIN', 'CANBERRA', 'DUBLIN', 'NORTH', 'SOUTH', 'EAST', 'WEST',
  'WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT',
])

/** Stable merchant key from a bank description, or null if nothing meaningful is left. */
export function merchantKey(description: string): string | null {
  const words = normaliseDescription(description).split(' ')
    .filter(w => w.length >= 2 && !/\d/.test(w) && !NOISE.has(w))
  if (!words.length) return null
  // One distinctive word is enough ("NETFLIX", "SPOTIFY"); short words need a second ("AMAZON PRIME", "HBF HEALTH").
  return words[0].length >= 7 || words.length === 1 ? words[0] : `${words[0]} ${words[1]}`
}

/** "AMAZON PRIME" → "Amazon Prime". */
export function merchantLabel(key: string): string {
  return key.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
}

export type DetectTx = {
  id: string
  date: string
  description: string
  aud_amount_cents: number
  category_id: string | null
  is_transfer?: boolean | null
}

export type Subscription = {
  /** Stable key: merchant|cadence (|$amount when one merchant has two at the same cadence). */
  key: string
  merchant: string
  merchantKey: string
  /** Latest bank description, for "show the why". */
  description: string
  cadence: Cadence
  /** Latest charge, positive cents (AUD). */
  amountCents: number
  monthlyCents: number
  annualCents: number
  firstSeen: string
  lastSeen: string
  /** Next expected charge on or after today (null if it looks ended). */
  nextDue: string | null
  active: boolean
  isNew: boolean
  priceChange: { fromCents: number; toCents: number; on: string } | null
  categoryId: string | null
  txIds: string[]
  count: number
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type Charge = { id: string; date: string; cents: number; description: string; categoryId: string | null }

function clusterByAmount(charges: Charge[]): Charge[][] {
  const sorted = [...charges].sort((a, b) => a.cents - b.cents)
  const out: Charge[][] = []
  for (const c of sorted) {
    const cur = out[out.length - 1]
    const prev = cur?.[cur.length - 1]
    if (prev && c.cents - prev.cents <= Math.max(DETECT.clusterGapMinCents, prev.cents * DETECT.clusterGapPct)) cur.push(c)
    else out.push([c])
  }
  return out.map(cl => cl.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)))
}

function cadenceOf(dates: readonly string[]): CadenceRule | null {
  if (dates.length < 2) return null
  const gaps = dates.slice(1).map((d, i) => dayDiff(dates[i], d))
  const typical = median(gaps)
  const rule = CADENCES.find(r => typical >= r.minDays && typical <= r.maxDays)
  if (!rule || dates.length < rule.minCount) return null
  const inWindow = gaps.filter(g => g >= rule.minDays && g <= rule.maxDays).length
  if (inWindow < Math.max(1, rule.minCount - 1) || inWindow / gaps.length < DETECT.regularShare) return null
  return rule
}

function steady(amounts: readonly number[]): boolean {
  if (amounts.length < 2) return false
  let ok = 0
  for (let i = 1; i < amounts.length; i++) {
    if (Math.abs(amounts[i] - amounts[i - 1]) <= Math.max(DETECT.steadyMinCents, amounts[i - 1] * DETECT.steadyPct)) ok++
  }
  return ok / (amounts.length - 1) >= DETECT.steadyShare
}

/** A steady price that moved to a new steady price (the new one may have charged once so far). */
export function priceChangeOf(charges: readonly { date: string; cents: number }[], today: string): Subscription['priceChange'] {
  const n = charges.length
  if (n < 3) return null
  const same = (a: number, b: number) => Math.abs(a - b) <= DETECT.samePriceCents
  const latest = charges[n - 1].cents
  let s = n - 1
  while (s > 0 && same(charges[s - 1].cents, latest)) s--
  if (s < 2) return null // need two charges at the old price
  const old = charges[s - 1].cents
  if (!same(charges[s - 2].cents, old)) return null
  if (Math.abs(latest - old) < DETECT.priceChangeMinCents) return null
  if (dayDiff(charges[s].date, today) > DETECT.priceChangeRecentDays) return null
  return { fromCents: old, toCents: latest, on: charges[s].date }
}

function nextDueOn(last: string, cadence: Cadence, today: string): string {
  let d = last
  for (let i = 0; i < 1000 && d < today; i++) d = advanceDate(d, cadence)
  return d === last ? advanceDate(last, cadence) : d
}

/**
 * Recurring outgoing charges in `txs` as of `today`. Transfers and money in
 * are ignored. EUR rows are compared on their AUD amount (aud_amount_cents).
 */
export function detectSubscriptions(txs: readonly DetectTx[], today: string): Subscription[] {
  const byMerchant = new Map<string, Charge[]>()
  for (const t of txs) {
    if (t.is_transfer || t.aud_amount_cents >= 0 || t.date > today) continue
    const key = merchantKey(t.description)
    if (!key) continue
    const list = byMerchant.get(key) ?? []
    list.push({ id: t.id, date: t.date, cents: -t.aud_amount_cents, description: t.description, categoryId: t.category_id })
    byMerchant.set(key, list)
  }

  const found: Subscription[] = []
  for (const [mKey, charges] of byMerchant) {
    for (const cluster of clusterByAmount(charges)) {
      const rule = cadenceOf(cluster.map(c => c.date))
      if (!rule) continue
      const shortCycle = rule.cadence === 'weekly' || rule.cadence === 'fortnightly' || rule.cadence === 'monthly'
      if (shortCycle && !steady(cluster.map(c => c.cents))) continue
      const last = cluster[cluster.length - 1]
      const activeWithin = Math.ceil(rule.maxDays * DETECT.activeFactor)
      const active = dayDiff(last.date, today) <= activeWithin
      const cats = new Map<string, number>()
      for (const c of cluster) if (c.categoryId) cats.set(c.categoryId, (cats.get(c.categoryId) ?? 0) + 1)
      const categoryId = [...cats].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      found.push({
        key: `${mKey}|${rule.cadence}`,
        merchant: merchantLabel(mKey),
        merchantKey: mKey,
        description: last.description,
        cadence: rule.cadence,
        amountCents: last.cents,
        monthlyCents: Math.round(last.cents * rule.perYear / 12),
        annualCents: last.cents * rule.perYear,
        firstSeen: cluster[0].date,
        lastSeen: last.date,
        nextDue: active ? nextDueOn(last.date, rule.cadence, today) : null,
        active,
        isNew: dayDiff(cluster[0].date, today) <= DETECT.newWithinDays,
        priceChange: priceChangeOf(cluster, today),
        categoryId,
        txIds: cluster.map(c => c.id),
        count: cluster.length,
      })
    }
  }

  // Two clusters with the same merchant and cadence get the amount in their key.
  const dupes = new Map<string, number>()
  for (const s of found) dupes.set(s.key, (dupes.get(s.key) ?? 0) + 1)
  for (const s of found) if ((dupes.get(s.key) ?? 0) > 1) s.key = `${s.key}|${Math.round(s.amountCents / 100)}`

  return found.sort((a, b) => b.monthlyCents - a.monthlyCents || a.key.localeCompare(b.key))
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly', quarterly: 'quarterly', annual: 'yearly',
}
