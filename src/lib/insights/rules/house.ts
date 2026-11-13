// Purchase-price thresholds: when the planned price sits just above a point
// where upfront costs jump (WA first-home duty cap, the 5% Deposit Scheme
// price cap, the FHOG cap), show what the same cash costs either side.

import { dutyCliffs } from '../../house/duty'
import { purchase } from '../../house/purchase'
import { DEPOSIT_SCHEME, WA_FHOG, ruleFor } from '../../house/rules'
import { dollars } from '../history'
import type { Insight, InsightContext } from '../types'

export const PRICE_CLIFF = { withinPct: 10, minDiffCents: 200_000 }

export function priceCliff(ctx: InsightContext): Insight[] {
  const h = ctx.house
  if (!h || h.date < ctx.today) return []
  const contractDate = h.date
  const cliffs: { priceCents: number; label: string }[] = [
    ...dutyCliffs({ firstHome: h.firstHome, kind: h.kind, contractDate }).filter(c => c.label.includes('ends')),
  ]
  if (h.firstHome && h.useScheme) cliffs.push({ priceCents: ruleFor(DEPOSIT_SCHEME, contractDate).capPerthCents, label: '5% Deposit Scheme price cap (Perth)' })
  if (h.firstHome && h.kind !== 'established') cliffs.push({ priceCents: ruleFor(WA_FHOG, contractDate).capSouthCents, label: 'First Home Owner Grant price cap' })

  const at = (price: number) => purchase({ priceCents: price, cashCents: h.cashCents, firstHome: h.firstHome, kind: h.kind, contractDate, useScheme: h.useScheme })
  const here = at(h.priceCents)
  const out: Insight[] = []
  for (const c of cliffs) {
    if (h.priceCents <= c.priceCents || h.priceCents > c.priceCents * (1 + PRICE_CLIFF.withinPct / 100)) continue
    const there = at(c.priceCents)
    const diff = here.costsCents - there.costsCents
    if (diff < PRICE_CLIFF.minDiffCents) continue
    const parts = [
      here.duty.payableCents !== there.duty.payableCents && `duty ${dollars(there.duty.payableCents)} → ${dollars(here.duty.payableCents)}`,
      here.lmi.totalCents !== there.lmi.totalCents && `LMI ${dollars(there.lmi.totalCents)} → ${dollars(here.lmi.totalCents)}`,
      here.fhog.amountCents !== there.fhog.amountCents && `FHOG ${dollars(there.fhog.amountCents)} → ${dollars(here.fhog.amountCents)}`,
    ].filter(Boolean)
    out.push({
      key: `price-cliff:${c.priceCents}:${h.priceCents}`,
      rule: 'price_cliff',
      title: `At ${dollars(h.priceCents)} upfront costs are about ${dollars(diff)} more than at ${dollars(c.priceCents)}`,
      detail: `${c.label} is ${dollars(c.priceCents)}. With your ${dollars(h.cashCents)} upfront cash: ${parts.join(', ')}. Worth knowing before you set a budget.`,
      impactCents: diff,
      impactLabel: `${dollars(diff)} upfront`,
      depositEffect: null,
      depositNote: 'Changes how much of your upfront cash goes to costs, not when you reach it.',
      evidence: [
        { kind: 'row', label: `Costs at ${dollars(h.priceCents)}`, value: dollars(here.costsCents) },
        { kind: 'row', label: `Costs at ${dollars(c.priceCents)}`, value: dollars(there.costsCents) },
      ],
      href: '/house',
      hrefLabel: 'House › Price explorer',
    })
  }
  return out
}
