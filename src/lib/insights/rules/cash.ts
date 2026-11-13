// Idle cash: a cash balance above a buffer earning well below the savings rate
// your plan assumes. Only accounts with a recorded interest rate are checked,
// because the projection already assumes the plan's rate for accounts without
// one (so flagging them would contradict the deposit date).

import { dollars } from '../history'
import type { Insight, InsightContext } from '../types'

export const IDLE_CASH = {
  minBufferCents: 200_000,        // $2,000 floor for the everyday buffer
  minIdleCents: 500_000,          // flag $5,000 or more above the buffer
  minGapPctPoints: 1,             // at least 1 percentage point below the plan's savings rate
  minAnnualCents: 10_000,         // and at least $100 a year
}

const CASH_TYPES = new Set(['bank', 'savings', 'cash'])

export function idleCash(ctx: InsightContext): Insight[] {
  const buffer = Math.max(IDLE_CASH.minBufferCents, ctx.monthlySpendCents)
  const out: Insight[] = []
  for (const a of ctx.accounts) {
    if (!CASH_TYPES.has(a.type) || a.currency !== 'AUD' || a.interestRatePct === null) continue
    const gap = ctx.cashRatePct - a.interestRatePct
    if (gap < IDLE_CASH.minGapPctPoints) continue
    const keep = a.type === 'bank' ? buffer : 0
    const idle = a.balanceCents - keep
    if (idle < IDLE_CASH.minIdleCents) continue
    const annual = Math.round(idle * gap / 100)
    if (annual < IDLE_CASH.minAnnualCents) continue
    out.push({
      key: `idle-cash:${a.id}`,
      rule: 'idle_cash',
      title: `${dollars(idle)} is earning ${a.interestRatePct}% in ${a.name}`,
      detail: `${keep ? `That's above a one-month buffer of ${dollars(keep)}. ` : ''}At the ${ctx.cashRatePct}% your plan assumes for savings it would earn about ${dollars(annual)} a year more (before tax).`,
      impactCents: annual,
      impactLabel: `${dollars(annual)}/yr`,
      depositEffect: { monthlyCents: Math.round(annual / 12) },
      evidence: [
        { kind: 'row', label: 'Balance', value: `${dollars(a.balanceCents)}${a.balanceAsOf ? ` on ${a.balanceAsOf}` : ''}` },
        { kind: 'row', label: 'Rate recorded on the account', value: `${a.interestRatePct}%` },
        { kind: 'row', label: 'Plan’s savings rate', value: `${ctx.cashRatePct}%` },
        ...(keep ? [{ kind: 'row' as const, label: 'Buffer kept aside', value: `${dollars(keep)} (a month of spending)` }] : []),
      ],
      href: '/track/accounts',
      hrefLabel: 'Accounts',
    })
  }
  return out
}
