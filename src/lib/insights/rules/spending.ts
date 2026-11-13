// Spending rules: a category spike vs its trailing median, a budget overrun,
// and lifestyle creep (discretionary spending growing faster than income).

import { addMonths } from '../../format'
import { budgetsForMonth } from '../../budgets'
import { categoryTxs, dollars, lastMonthOf, median, monthName, monthsWithData, plural, spendHistory, spendRoots, txEvidence } from '../history'
import type { Insight, InsightContext } from '../types'

export const SPIKE = {
  historyMonths: 6,
  /** Months of earlier data needed before a spike can be called. */
  minHistoryMonths: 3,
  minRisePct: 30,
  minRiseCents: 15_000,
  minMedianCents: 5_000,
  /** "N transactions over $60". */
  bigTxCents: 6_000,
}

export function categorySpike(ctx: InsightContext): Insight[] {
  const month = lastMonthOf(ctx.thisMonth)
  const data = monthsWithData(ctx.transactions)
  if (!data.has(month)) return []
  const history = Array.from({ length: SPIKE.historyMonths }, (_, i) => addMonths(month, -SPIKE.historyMonths + i)).filter(m => data.has(m))
  if (history.length < SPIKE.minHistoryMonths) return []
  const spend = spendHistory(ctx, [month, ...history])
  const out: Insight[] = []
  for (const c of spendRoots(ctx.categories)) {
    const now = spend.get(month)!.get(c.id) ?? 0
    const med = median(history.map(m => spend.get(m)!.get(c.id) ?? 0))
    if (med < SPIKE.minMedianCents) continue
    const rise = now - med
    if (rise < SPIKE.minRiseCents || rise * 100 < med * SPIKE.minRisePct) continue
    const pct = Math.round(rise / med * 100)
    const txs = categoryTxs(ctx, c.id, month).filter(t => t.aud_amount_cents < 0)
    const big = txs.filter(t => -t.aud_amount_cents > SPIKE.bigTxCents).length
    out.push({
      key: `spike:${c.id}`,
      rule: 'category_spike',
      title: `${c.name} was ${dollars(now)} in ${monthName(month)}, +${pct}% on your ${history.length}-month median (${dollars(med)})`,
      detail: `${plural(txs.length, 'transaction')}${big ? `, ${big} over ${dollars(SPIKE.bigTxCents)}` : ''}. ${dollars(rise)} above the usual month.`,
      impactCents: rise,
      impactLabel: `${dollars(rise)} above usual`,
      depositEffect: { oneOffCents: rise },
      evidence: txs.slice(0, 8).map(txEvidence),
      href: '/spending',
      hrefLabel: 'Spending',
      group: `category:${c.id}`,
    })
  }
  return out
}

export const OVERRUN = { minOverPct: 10, minOverCents: 5_000 }

export function budgetOverrun(ctx: InsightContext): Insight[] {
  const month = lastMonthOf(ctx.thisMonth)
  const targets = budgetsForMonth(ctx.budgets, month)
  if (!targets.size) return []
  const spent = spendHistory(ctx, [month]).get(month)!
  const out: Insight[] = []
  for (const c of spendRoots(ctx.categories)) {
    const target = targets.get(c.id)
    if (!target) continue
    const s = spent.get(c.id) ?? 0
    const over = s - target
    if (over < OVERRUN.minOverCents || over * 100 < target * OVERRUN.minOverPct) continue
    out.push({
      key: `budget-over:${c.id}`,
      rule: 'budget_overrun',
      title: `${c.name} was ${dollars(over)} over its ${dollars(target)} target in ${monthName(month)}`,
      detail: `Spent ${dollars(s)} against a light monthly target of ${dollars(target)}.`,
      impactCents: over,
      impactLabel: `${dollars(over)} over`,
      depositEffect: { oneOffCents: over },
      evidence: categoryTxs(ctx, c.id, month).filter(t => t.aud_amount_cents < 0).slice(0, 8).map(txEvidence),
      href: '/more/budgets',
      hrefLabel: 'Budgets',
      group: `category:${c.id}`,
    })
  }
  return out
}

export const CREEP = { minGapPctPoints: 5, minRiseCents: 100_000 }

/** Needs 24 complete months of data: the last 12 vs the 12 before. */
export function lifestyleCreep(ctx: InsightContext): Insight[] {
  const last = lastMonthOf(ctx.thisMonth)
  const recent = Array.from({ length: 12 }, (_, i) => addMonths(last, -11 + i))
  const prior = recent.map(m => addMonths(m, -12))
  const data = monthsWithData(ctx.transactions)
  if (![...recent, ...prior].every(m => data.has(m))) return []
  const byId = new Map(ctx.categories.map(c => [c.id, c]))
  const disc = new Set(spendRoots(ctx.categories).filter(c => c.kind === 'discretionary').map(c => c.id))
  const spend = spendHistory(ctx, [...prior, ...recent])
  const sumDisc = (ms: string[]) => ms.reduce((s, m) => s + [...spend.get(m)!].filter(([k]) => disc.has(k)).reduce((a, [, v]) => a + v, 0), 0)
  const income = (ms: string[]) => ctx.transactions.filter(t => !t.is_transfer && t.aud_amount_cents > 0 && ms.includes(t.date.slice(0, 7))
    && (!t.category_id || byId.get(t.category_id)?.kind === 'income')).reduce((s, t) => s + t.aud_amount_cents, 0)
  const d0 = sumDisc(prior), d1 = sumDisc(recent), i0 = income(prior), i1 = income(recent)
  if (d0 <= 0 || i0 <= 0) return []
  const gD = (d1 - d0) / d0, gI = (i1 - i0) / i0
  if ((gD - gI) * 100 < CREEP.minGapPctPoints) return []
  const excess = Math.round(d1 - d0 * (1 + Math.max(0, gI)))
  if (excess < CREEP.minRiseCents) return []
  return [{
    key: 'lifestyle-creep',
    rule: 'lifestyle_creep',
    title: `Discretionary spending is up ${Math.round(gD * 100)}% year on year; money in is up ${Math.round(gI * 100)}%`,
    detail: `${dollars(d1)} in the last 12 months vs ${dollars(d0)} the year before. Growing in line with income would be about ${dollars(excess)} less.`,
    impactCents: excess,
    impactLabel: `${dollars(excess)}/yr`,
    depositEffect: { monthlyCents: Math.round(excess / 12) },
    evidence: [
      { kind: 'row', label: 'Discretionary, last 12 months', value: dollars(d1) },
      { kind: 'row', label: 'Discretionary, 12 months before', value: dollars(d0) },
      { kind: 'row', label: 'Money in, last 12 vs before', value: `${dollars(i1)} vs ${dollars(i0)}` },
    ],
    href: '/spending',
    hrefLabel: 'Spending',
  }]
}
