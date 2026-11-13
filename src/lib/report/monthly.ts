// Monthly PDF report (Phase 5): pure data assembly. The loader (report action)
// fetches rows; this turns them into one plain, serialisable object; the PDF
// renderer (pdf.tsx) only lays it out. Money is integer AUD cents.
//
// What a past month can and can't show: net worth, income vs spending and
// budget results are for the chosen month. Insights, bills, the deposit goal,
// the super cap and the home loan are "as at" the day the report is made (they
// describe now and the road ahead, not history); the report says so.

import { budgetsForMonth, spendByCategory, UNCATEGORISED, type BudgetRow, type SpendTx } from '../budgets'
import { explainNetWorth, monthSummary } from '../checkin'
import type { BalanceSnapshot } from '../balances'
import { BASELINE_EXCLUDE } from '../projection/inputs'
import { depositDaysLabel } from '../insights/labels'
import type { Insight } from '../insights/types'
import type { Subscription } from '../subscriptions/detect'
import type { Bill } from '../subscriptions/bills'
import type { CapLine } from '../superCap'
import type { HomeLoanStatus } from '../house/homeLoan'
import type { DepositGoal } from '../projection/plan'
import type { CategoryKind } from '../supabase/database.types'

export const REPORT_DISCLAIMER = 'Estimates from your own numbers, not financial advice.'

export type ReportCategory = { id: string; name: string; parent_id: string | null; kind: CategoryKind | null }

export type ReportInput = {
  month: string
  today: string
  /** e.g. '13 Nov 2026, 9:41 am' (Perth). */
  generatedAt: string
  txs: readonly SpendTx[]
  categories: readonly ReportCategory[]
  budgets: readonly BudgetRow[]
  snapshots: readonly BalanceSnapshot[]
  accounts: readonly { id: string; name: string }[]
  /** Ranked insights (shown first). */
  insights: readonly Insight[]
  subscriptions: readonly Subscription[]
  bills: readonly Bill[]
  deposit: DepositGoal | null
  sacrifice: readonly { name: string; annualCents: number }[]
  fhssOn: boolean
  capLines: readonly CapLine[]
  homeLoan: HomeLoanStatus | null
}

export type BudgetResult = { id: string; name: string; targetCents: number | null; spentCents: number; diffCents: number | null; status: 'under' | 'over' | 'no_target' }

export type MonthlyReport = {
  month: string
  today: string
  generatedAt: string
  /** True when the month is before the current one (the usual case). */
  complete: boolean
  netWorth: { startCents: number; endCents: number; changeCents: number; rows: { label: string; cents: number; detail?: string }[]; accounts: { name: string; endCents: number; changeCents: number; updated: boolean }[] }
  cashflow: { incomeCents: number; spentCents: number; savedCents: number; savedPct: number | null }
  budgets: { lines: BudgetResult[]; totalTargetCents: number; totalSpentOnTargetsCents: number; overCount: number }
  insights: { title: string; impactLabel: string; deposit: string | null; detail: string }[]
  subscriptions: { count: number; monthlyCents: number; items: { name: string; cadence: string; amountCents: number; monthlyCents: number }[] }
  bills: { date: string; label: string; cents: number }[]
  deposit: {
    eventName: string; currentCents: number; targetCents: number; pct: number; byMonth: string
    projectedMonth: string | null; monthsLate: number | null; extraMonthlyCents: number | null
    fhss: { netCents: number; month: string } | null
  } | null
  sacrifice: { name: string; annualCents: number }[]
  fhssOn: boolean
  superCap: { name: string; fy: string; sgCents: number; voluntaryCents: number; plannedCents: number; capCents: number; headroomCents: number }[]
  homeLoan: {
    loanName: string; source: 'account' | 'plan'; balanceCents: number; offsetCents: number; ratePct: number; effectiveRatePct: number
    interestThisMonthCents: number; savedByOffsetThisMonthCents: number; repaymentCents: number; payoffMonth: string | null; payoffWithoutOffsetMonth: string | null
  } | null
  disclaimer: string
}

const MAX_INSIGHTS = 5
const MAX_ITEMS = 8

export function buildMonthlyReport(p: ReportInput): MonthlyReport {
  const thisMonth = p.today.slice(0, 7)
  const nw = explainNetWorth({ month: p.month, snapshots: p.snapshots, accounts: p.accounts, txs: p.txs, categories: p.categories })
  const sum = monthSummary(p.txs, p.categories, p.budgets, p.month)

  // Budget results: every top-level spending category with a target or any spending.
  const targets = budgetsForMonth(p.budgets, p.month)
  const spent = spendByCategory(p.txs, p.month, p.categories, { rollup: true })
  const roots = p.categories.filter(c => !c.parent_id && c.kind !== 'income' && c.kind !== 'transfer' && c.kind !== 'savings' && !BASELINE_EXCLUDE.test(c.name))
  const lines: BudgetResult[] = roots.map(c => {
    const t = targets.get(c.id) ?? 0
    const s = spent.get(c.id) ?? 0
    return t > 0
      ? { id: c.id, name: c.name, targetCents: t, spentCents: s, diffCents: t - s, status: s > t ? 'over' as const : 'under' as const }
      : { id: c.id, name: c.name, targetCents: null, spentCents: s, diffCents: null, status: 'no_target' as const }
  }).filter(l => l.targetCents !== null || l.spentCents !== 0)
  const unc = spent.get(UNCATEGORISED) ?? 0
  if (unc) lines.push({ id: UNCATEGORISED, name: 'Uncategorised', targetCents: null, spentCents: unc, diffCents: null, status: 'no_target' })
  lines.sort((a, b) => Number(b.targetCents !== null) - Number(a.targetCents !== null) || b.spentCents - a.spentCents)
  const withTarget = lines.filter(l => l.targetCents !== null)

  const insights = p.insights.slice(0, MAX_INSIGHTS).map(i => ({
    title: i.title,
    impactLabel: i.impactLabel,
    deposit: depositDaysLabel(i.depositDays) ?? null,
    detail: i.detail,
  }))

  const subs = [...p.subscriptions].sort((a, b) => b.monthlyCents - a.monthlyCents)
  const d = p.deposit
  const hl = p.homeLoan

  return {
    month: p.month,
    today: p.today,
    generatedAt: p.generatedAt,
    complete: p.month < thisMonth,
    netWorth: {
      startCents: nw.startCents, endCents: nw.endCents, changeCents: nw.changeCents,
      rows: nw.rows.map(r => ({ label: r.label, cents: r.cents, detail: r.detail })),
      accounts: nw.accounts.slice(0, MAX_ITEMS).map(a => ({ name: a.name, endCents: a.endCents, changeCents: a.changeCents, updated: a.updated })),
    },
    cashflow: { incomeCents: sum.incomeCents, spentCents: sum.spentCents, savedCents: sum.savedCents, savedPct: sum.savedPct },
    budgets: {
      lines,
      totalTargetCents: withTarget.reduce((s, l) => s + (l.targetCents ?? 0), 0),
      totalSpentOnTargetsCents: withTarget.reduce((s, l) => s + l.spentCents, 0),
      overCount: withTarget.filter(l => l.status === 'over').length,
    },
    insights,
    subscriptions: {
      count: subs.length,
      monthlyCents: subs.reduce((s, x) => s + x.monthlyCents, 0),
      items: subs.slice(0, MAX_ITEMS).map(s => ({ name: s.merchant, cadence: s.cadence, amountCents: s.amountCents, monthlyCents: s.monthlyCents })),
    },
    bills: p.bills.slice(0, MAX_ITEMS).map(b => ({ date: b.date, label: b.label, cents: b.cents })),
    deposit: d ? {
      eventName: d.eventName, currentCents: d.currentCents, targetCents: d.targetCents,
      pct: d.targetCents > 0 ? Math.max(0, Math.min(100, Math.round(d.currentCents / d.targetCents * 100))) : 0,
      byMonth: d.byMonth, projectedMonth: d.projectedMonth, monthsLate: d.monthsLate, extraMonthlyCents: d.extraMonthlyCents, fhss: d.fhss,
    } : null,
    sacrifice: p.sacrifice.filter(s => s.annualCents > 0).map(s => ({ ...s })),
    fhssOn: p.fhssOn,
    superCap: p.capLines.map(l => ({ name: l.name, fy: l.fy, sgCents: l.sgCents, voluntaryCents: l.voluntaryCents, plannedCents: l.plannedCents, capCents: l.capCents, headroomCents: l.headroomCents })),
    homeLoan: hl ? {
      loanName: hl.loanName, source: hl.source, balanceCents: hl.balanceCents, offsetCents: hl.offsetCents, ratePct: hl.ratePct, effectiveRatePct: hl.effectiveRatePct,
      interestThisMonthCents: hl.interestThisMonthCents, savedByOffsetThisMonthCents: hl.savedByOffsetThisMonthCents, repaymentCents: hl.repaymentCents,
      payoffMonth: hl.payoff?.month ?? null, payoffWithoutOffsetMonth: hl.payoffWithoutOffset?.month ?? null,
    } : null,
    disclaimer: REPORT_DISCLAIMER,
  }
}

/** Months the report can be made for: the last 24 complete months, newest first. */
export function reportMonths(thisMonth: string, count = 24): string[] {
  const [y, m] = thisMonth.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const t = y * 12 + (m - 1) - (i + 1)
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
  })
}

export function isReportMonth(month: string, thisMonth: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && reportMonths(thisMonth).includes(month)
}
