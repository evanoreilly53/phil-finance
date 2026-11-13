// FX and international fees, and exposure of EUR still to pay to the rate.

import { addDays } from '../../import/dates'
import { normaliseDescription } from '../../import/fingerprint'
import { dollars, plural, txEvidence } from '../history'
import type { Insight, InsightContext, InsightTx } from '../types'

export const FX = { minFeesCents: 2_000, lookbackDays: 365, sensitivityPct: 5, minExposureAudCents: 200_000 }

const FEE = /\b(INTNL|INTL|INTERNATIONAL|OVERSEAS|OFFSHORE|FOREIGN)\b.*\bFEES?\b|\bFOREIGN (CURRENCY|TRANSACTION|EXCHANGE)\b|\bFX\b.*\bFEES?\b|\bCURRENCY CONVERSION\b|\bCONVERSION FEES?\b/

export function isFxFee(t: Pick<InsightTx, 'description' | 'aud_amount_cents' | 'is_transfer'>): boolean {
  return !t.is_transfer && t.aud_amount_cents < 0 && FEE.test(normaliseDescription(t.description))
}

export function fxFees(ctx: InsightContext): Insight[] {
  const since = addDays(ctx.today, -FX.lookbackDays)
  const fees = ctx.transactions.filter(t => t.date >= since && t.date <= ctx.today && isFxFee(t))
  const total = -fees.reduce((s, t) => s + t.aud_amount_cents, 0)
  if (total < FX.minFeesCents) return []
  const eurRows = ctx.transactions.filter(t => t.date >= since && t.currency === 'EUR' && !t.is_transfer).length
  return [{
    key: 'fx-fees',
    rule: 'fx_fees',
    title: `You paid ${dollars(total)} in FX and international fees in the last 12 months`,
    detail: `${plural(fees.length, 'fee charge')}${eurRows ? `, alongside ${plural(eurRows, 'EUR payment')}` : ''}. Fees like these are a pattern some accounts and cards don't charge.`,
    impactCents: total,
    impactLabel: `${dollars(total)}/yr`,
    depositEffect: { monthlyCents: Math.round(total / 12) },
    evidence: fees.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8).map(txEvidence),
    href: '/transactions',
    hrefLabel: 'Transactions',
  }]
}

export function eurExposure(ctx: InsightContext): Insight[] {
  const future = ctx.plannedEur // planned and unpaid (overdue ones included: still to pay)
  const eur = future.reduce((s, p) => s + Math.abs(p.nativeCents), 0)
  const aud = Math.round(eur * ctx.eurAudRate)
  if (aud < FX.minExposureAudCents) return []
  const swing = Math.round(aud * FX.sensitivityPct / 100)
  const eurText = `€${Math.round(eur / 100).toLocaleString('en-IE')}`
  return [{
    key: 'eur-exposure',
    rule: 'eur_exposure',
    title: `${eurText} still to pay in EUR: a ${FX.sensitivityPct}% move in the rate changes the AUD cost by about ${dollars(swing)}`,
    detail: `${dollars(aud)} at today's ${ctx.eurAudRate} AUD per EUR, across ${plural(future.length, 'planned payment')}.`,
    impactCents: swing,
    impactLabel: `±${dollars(swing)}`,
    depositEffect: null,
    depositNote: 'A sensitivity, not a saving: the projection uses today’s rate.',
    evidence: future.slice(0, 8).map(p => ({ kind: 'row' as const, label: `${p.description} (${p.date})`, value: `€${(Math.abs(p.nativeCents) / 100).toLocaleString('en-IE', { minimumFractionDigits: 2 })}` })),
    href: '/future',
    hrefLabel: 'Future',
  }]
}
