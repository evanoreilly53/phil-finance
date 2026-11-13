// Upcoming bills: detected subscriptions + recurring planned items, expanded
// into dated occurrences for the Bills calendar. Pure.

import { addDays } from '../import/dates'
import { advanceDate, type RecurrenceFreq } from '../plannedItems'
import type { Subscription } from './detect'

export type SubscriptionMark = { key: string; state: 'tracked' | 'dismissed'; refId: string | null }

export type PlannedRecurring = {
  id: string
  description: string
  amountCents: number          // native currency, sign ignored (expense)
  currency: string
  frequency: RecurrenceFreq
  nextDue: string
}

export type Bill = {
  date: string
  label: string
  /** AUD cents (planned items in another currency use `fx`), positive. */
  cents: number
  source: 'detected' | 'planned'
  /** Subscription key or planned_cashflows id. */
  ref: string
  currency: string
  nativeCents: number
}

/** Subscriptions still worth showing: active, not dismissed, not already tracked as a planned item. */
export function visibleSubscriptions(subs: readonly Subscription[], marks: readonly SubscriptionMark[]): { untracked: Subscription[]; tracked: Subscription[]; dismissed: Subscription[] } {
  const byKey = new Map(marks.map(m => [m.key, m]))
  const untracked: Subscription[] = [], tracked: Subscription[] = [], dismissed: Subscription[] = []
  for (const s of subs) {
    const m = byKey.get(s.key)
    if (m?.state === 'dismissed') dismissed.push(s)
    else if (m?.state === 'tracked') tracked.push(s)
    else if (s.active) untracked.push(s)
  }
  return { untracked, tracked, dismissed }
}

/**
 * Every bill due from `today` to `today + days` (inclusive), soonest first.
 * Detected subscriptions that are tracked or dismissed are left out (a tracked
 * one appears through its planned item).
 */
export function upcomingBills(p: {
  subscriptions: readonly Subscription[]
  marks: readonly SubscriptionMark[]
  planned: readonly PlannedRecurring[]
  today: string
  days?: number
  fx?: Readonly<Record<string, number>>
}): Bill[] {
  const end = addDays(p.today, p.days ?? 35)
  const out: Bill[] = []
  const expand = (start: string, freq: RecurrenceFreq, push: (d: string) => void) => {
    let d = start
    for (let i = 0; i < 500 && d < p.today; i++) d = advanceDate(d, freq)
    for (let i = 0; i < 60 && d <= end; i++) { push(d); d = advanceDate(d, freq) }
  }
  for (const s of visibleSubscriptions(p.subscriptions, p.marks).untracked) {
    if (!s.nextDue) continue
    expand(s.nextDue, s.cadence, d => out.push({ date: d, label: s.merchant, cents: s.amountCents, source: 'detected', ref: s.key, currency: 'AUD', nativeCents: s.amountCents }))
  }
  for (const r of p.planned) {
    const rate = r.currency === 'AUD' ? 1 : p.fx?.[r.currency] ?? null
    const native = Math.abs(r.amountCents)
    expand(r.nextDue, r.frequency, d => out.push({
      date: d, label: r.description, cents: rate === null ? 0 : Math.round(native * rate), source: 'planned', ref: r.id, currency: r.currency, nativeCents: native,
    }))
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.cents - a.cents))
}

/** Calendar grid: weeks (Mon–Sun) covering today … today + days, each day with its bills. */
export function billCalendar(bills: readonly Bill[], today: string, days = 35): { date: string; inRange: boolean; bills: Bill[] }[][] {
  const [y, m, d] = today.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // Mon = 0
  const start = addDays(today, -dow)
  const end = addDays(today, days)
  const byDate = new Map<string, Bill[]>()
  for (const b of bills) byDate.set(b.date, [...(byDate.get(b.date) ?? []), b])
  const weeks: { date: string; inRange: boolean; bills: Bill[] }[][] = []
  for (let w = 0; ; w++) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, w * 7 + i)
      return { date, inRange: date >= today && date <= end, bills: byDate.get(date) ?? [] }
    })
    weeks.push(week)
    if (week[6].date >= end || w > 10) break
  }
  return weeks
}
