// New recurring charges and price rises, from the subscription detector.

import { CADENCES, CADENCE_LABEL } from '../../subscriptions/detect'
import { dollars, dollarsCents, mon, plural } from '../history'
import type { Insight, InsightContext } from '../types'

const perYear = (c: string) => CADENCES.find(r => r.cadence === c)?.perYear ?? 12

export function subscriptionChanges(ctx: InsightContext): Insight[] {
  const marks = new Map(ctx.subscriptionMarks.map(m => [m.key, m.state]))
  const live = ctx.subscriptions.filter(s => s.active && marks.get(s.key) !== 'dismissed')
  const fresh = live.filter(s => s.isNew && marks.get(s.key) !== 'tracked')
  const rises = live.filter(s => s.priceChange && s.priceChange.toCents > s.priceChange.fromCents)
  if (!fresh.length && !rises.length) return []

  const newMonthly = fresh.reduce((s, x) => s + x.monthlyCents, 0)
  const riseMonthly = rises.reduce((s, x) => s + Math.round((x.priceChange!.toCents - x.priceChange!.fromCents) * perYear(x.cadence) / 12), 0)
  const since = fresh.length ? fresh.map(s => s.firstSeen).sort()[0].slice(0, 7) : null
  const riseText = rises.map(s => `${s.merchant} went up ${dollarsCents(s.priceChange!.toCents - s.priceChange!.fromCents)} (${CADENCE_LABEL[s.cadence]}) from ${s.priceChange!.on}`).join('; ')

  const title = fresh.length
    ? `${plural(fresh.length, 'new recurring charge')} since ${mon(since!)}: ${dollars(newMonthly)}/mo`
    : `${plural(rises.length, 'recurring charge')} went up: +${dollars(riseMonthly)}/mo`
  const detail = [
    fresh.length ? `${fresh.map(s => `${s.merchant} ${dollarsCents(s.amountCents)} ${CADENCE_LABEL[s.cadence]}`).join(', ')}.` : '',
    fresh.length && rises.length ? `${riseText}.` : rises.length ? `${riseText}.` : '',
  ].filter(Boolean).join(' ')

  const monthly = newMonthly + riseMonthly
  const keyParts = [...fresh.map(s => s.key), ...rises.map(s => `${s.key}>${s.priceChange!.toCents}`)].sort()
  const evidence = [...fresh, ...rises.filter(r => !fresh.includes(r))].map(s => ({
    kind: 'tx' as const, id: s.txIds[s.txIds.length - 1], date: s.lastSeen, description: s.description, cents: -s.amountCents,
  }))
  return [{
    key: `subscriptions:${keyParts.join(',')}`,
    rule: 'subscriptions',
    title,
    detail,
    impactCents: monthly * 12,
    impactLabel: `${dollars(monthly * 12)}/yr`,
    depositEffect: { monthlyCents: monthly },
    evidence,
    href: '/track/bills',
    hrefLabel: 'Bills & subscriptions',
  }]
}
