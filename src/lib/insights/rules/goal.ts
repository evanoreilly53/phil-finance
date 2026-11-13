// Goal drift: the house deposit is projected later than its target, or later
// than it was at last month's check-in.

import { monthDiff } from '../../projection/schedule'
import { dollars, mon, plural } from '../history'
import type { Insight, InsightContext } from '../types'

/** Month order with 'now' first and null (never) last. */
function order(m: string | null): string { return m === null ? '9999-99' : m === 'now' ? '0000-00' : m }

export function goalDrift(ctx: InsightContext): Insight[] {
  const d = ctx.deposit
  if (!d || d.projectedMonth === 'now') return []
  const prev = ctx.previousCheckin && ctx.previousCheckin.month < ctx.thisMonth ? ctx.previousCheckin.depositProjectedMonth : undefined
  const slipped = prev !== undefined && order(d.projectedMonth) > order(prev)
  const slipMonths = slipped && prev && prev !== 'now' && d.projectedMonth ? monthDiff(prev, d.projectedMonth) : null
  const behind = d.projectedMonth === null || (d.monthsLate ?? 0) > 0
  if (!behind && !slipped) return []

  const where = d.projectedMonth ? mon(d.projectedMonth) : 'beyond the projection'
  const title = behind
    ? d.projectedMonth
      ? `Deposit projected for ${where}, ${plural(d.monthsLate ?? 0, 'month')} after your ${mon(d.byMonth)} target`
      : `At the current pace the deposit isn't reached in the projection (target ${mon(d.byMonth)})`
    : `Deposit date moved to ${where}, still before your ${mon(d.byMonth)} target`
  const parts: string[] = []
  if (slipped) parts.push(prev === null ? 'Last month it was also not reached.' : `Last month's check-in projected ${prev === 'now' ? 'it as already reached' : mon(prev!)}${slipMonths ? ` (${plural(slipMonths, 'month')} earlier)` : ''}.`)
  if (d.extraMonthlyCents && d.extraMonthlyCents > 0) parts.push(`Saving +${dollars(d.extraMonthlyCents)}/mo more gets it back to ${mon(d.byMonth)}.`)
  parts.push(`Target: ${dollars(d.targetCents)} upfront cash for "${d.eventName}".`)

  const extra = d.extraMonthlyCents && d.extraMonthlyCents > 0 ? d.extraMonthlyCents : 0
  return [{
    key: 'goal-drift',
    rule: 'goal_drift',
    title,
    detail: parts.join(' '),
    impactCents: extra * 12,
    impactLabel: extra ? `+${dollars(extra)}/mo to close` : 'date moved',
    depositEffect: extra ? { monthlyCents: extra } : null,
    depositNote: extra ? undefined : 'Already on time for the target.',
    evidence: [
      { kind: 'row', label: 'Projected', value: d.projectedMonth ? mon(d.projectedMonth) : 'not within the projection' },
      { kind: 'row', label: 'Target', value: mon(d.byMonth) },
      ...(prev !== undefined ? [{ kind: 'row' as const, label: 'Last month’s projection', value: prev === null ? 'not within the projection' : prev === 'now' ? 'reached' : mon(prev) }] : []),
    ],
    href: '/future',
    hrefLabel: 'See the projection',
  }]
}
