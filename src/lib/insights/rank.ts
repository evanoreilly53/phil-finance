// Ranking, the 3-a-month cap, and Done / Snooze / "That's intentional". Pure.

import type { Insight, InsightStateRow, RuleId } from './types'

export const MAX_SHOWN = 3

/** Tie-break order when two insights have the same $ impact. */
const RULE_ORDER: RuleId[] = [
  'goal_drift', 'fhss_window', 'cap_headroom', 'idle_cash', 'subscriptions', 'category_spike', 'budget_overrun',
  'lifestyle_creep', 'price_cliff', 'fx_fees', 'eur_exposure', 'stale_data', 'uncategorised',
]

export type Hidden = { insight: Insight; why: 'done' | 'snoozed' | 'intentional'; until?: string }

export type Ranked = {
  /** Up to MAX_SHOWN, highest $ impact first (EOFY items first in April–June). */
  shown: Insight[]
  /** The rest, for "See all". */
  more: Insight[]
  /** Done this month, snoozed, or marked intentional. */
  hidden: Hidden[]
}

export function isEofy(today: string): boolean {
  return ['04', '05', '06'].includes(today.slice(5, 7))
}

/** Which state (if any) hides an insight today. */
export function hiddenBy(state: InsightStateRow | undefined, today: string, thisMonth: string): Hidden['why'] | null {
  if (!state) return null
  if (state.state === 'intentional') return 'intentional'
  if (state.state === 'snoozed' && state.snooze_until && state.snooze_until > today) return 'snoozed'
  if (state.state === 'done' && state.done_month === thisMonth) return 'done'
  return null
}

/** Keep the largest-impact insight in each dedupe group. */
export function dedupe(insights: readonly Insight[]): Insight[] {
  const best = new Map<string, Insight>()
  const out: Insight[] = []
  for (const i of insights) {
    if (!i.group) { out.push(i); continue }
    const cur = best.get(i.group)
    if (!cur || i.impactCents > cur.impactCents) best.set(i.group, i)
  }
  return [...out, ...best.values()]
}

export function compareInsights(a: Insight, b: Insight, today: string): number {
  const ts = (i: Insight) => (isEofy(today) && i.timeSensitive ? 1 : 0)
  return ts(b) - ts(a)
    || b.impactCents - a.impactCents
    || RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule)
    || a.key.localeCompare(b.key)
}

export function rankInsights(
  candidates: readonly Insight[],
  states: readonly InsightStateRow[],
  opts: { today: string; thisMonth: string; max?: number },
): Ranked {
  const byKey = new Map(states.map(s => [s.key, s]))
  const visible: Insight[] = []
  const hidden: Hidden[] = []
  for (const i of dedupe(candidates)) {
    const s = byKey.get(i.key)
    const why = hiddenBy(s, opts.today, opts.thisMonth)
    if (why) hidden.push({ insight: i, why, ...(why === 'snoozed' ? { until: s!.snooze_until! } : {}) })
    else visible.push(i)
  }
  visible.sort((a, b) => compareInsights(a, b, opts.today))
  const max = opts.max ?? MAX_SHOWN
  return { shown: visible.slice(0, max), more: visible.slice(max), hidden }
}
