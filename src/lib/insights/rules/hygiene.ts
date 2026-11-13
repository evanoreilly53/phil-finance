// Data hygiene: stale accounts and an uncategorised backlog. No dollar
// impact of their own, so they rank after anything with one.

import { addDays } from '../../import/dates'
import { agoLabel, freshness } from '../../freshness'
import { dollars, plural, txEvidence } from '../history'
import type { Insight, InsightContext } from '../types'

export function staleData(ctx: InsightContext): Insight[] {
  const stale = ctx.accounts
    .map(a => ({ a, f: freshness(a.dataAsOf, ctx.today, a.type) }))
    .filter(({ a, f }) => f.status === 'stale' || (f.status === 'never' && a.balanceCents !== 0))
    .sort((x, y) => (y.f.days ?? 1e9) - (x.f.days ?? 1e9))
  if (!stale.length) return []
  const first = stale[0]
  const title = stale.length === 1
    ? `${first.a.name} hasn't been updated ${first.a.dataAsOf ? `since ${first.a.dataAsOf}` : 'yet'}`
    : `${plural(stale.length, 'account')} haven't been updated recently`
  return [{
    key: `stale-data:${stale.map(s => `${s.a.id}@${s.a.dataAsOf ?? 'never'}`).sort().join(',')}`,
    rule: 'stale_data',
    title,
    detail: 'Projections assume no change since the last balance or import. Import a statement or update the balance.',
    impactCents: 0,
    impactLabel: 'data',
    depositEffect: null,
    depositNote: 'Keeps the projection honest rather than moving it.',
    evidence: stale.map(({ a, f }) => ({ kind: 'row' as const, label: a.name, value: a.dataAsOf ? `fresh to ${a.dataAsOf} (${agoLabel(f.days)})` : 'never updated' })),
    href: '/track/accounts',
    hrefLabel: 'Accounts',
  }]
}

export const UNCATEGORISED = { lookbackDays: 90, minCount: 5 }

export function uncategorised(ctx: InsightContext): Insight[] {
  const since = addDays(ctx.today, -UNCATEGORISED.lookbackDays)
  const rows = ctx.transactions.filter(t => !t.is_transfer && !t.category_id && t.date >= since && t.aud_amount_cents < 0)
  if (rows.length < UNCATEGORISED.minCount) return []
  const total = -rows.reduce((s, t) => s + t.aud_amount_cents, 0)
  return [{
    key: 'uncategorised',
    rule: 'uncategorised',
    title: `${plural(rows.length, 'transaction')} from the last 90 days ${rows.length === 1 ? 'has' : 'have'} no category (${dollars(total)})`,
    detail: 'Uncategorised spending can’t be compared with budgets or past months. The review queue sorts them quickly and can learn a rule.',
    impactCents: 0,
    impactLabel: 'data',
    depositEffect: null,
    depositNote: 'Tidying data doesn’t move the deposit date.',
    evidence: rows.sort((a, b) => a.aud_amount_cents - b.aud_amount_cents).slice(0, 8).map(txEvidence),
    href: '/transactions/review',
    hrefLabel: 'Review queue',
  }]
}
