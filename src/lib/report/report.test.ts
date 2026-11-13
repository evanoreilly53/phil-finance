import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { buildMonthlyReport, reportMonths, isReportMonth, REPORT_DISCLAIMER, type ReportInput } from './monthly'
import type { Insight } from '../insights/types'

const $ = (d: number) => Math.round(d * 100)

const categories: ReportInput['categories'] = [
  { id: 'groc', name: 'Groceries', parent_id: null, kind: 'essential' },
  { id: 'eat', name: 'Eating Out', parent_id: null, kind: 'discretionary' },
  { id: 'cafe', name: 'Cafes', parent_id: 'eat', kind: 'discretionary' },
  { id: 'sal', name: 'Salary', parent_id: null, kind: 'income' },
  { id: 'fun', name: 'Fun', parent_id: null, kind: 'discretionary' },
]

const insight = (title: string, depositDays: number | null): Insight => ({
  key: title, rule: 'idle_cash', title, detail: 'Because.', impactCents: $(100), impactLabel: '$100/yr', depositEffect: null, depositDays, evidence: [],
})

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    month: '2026-10', today: '2026-11-13', generatedAt: '13 Nov 2026, 9:00 am',
    txs: [
      { date: '2026-10-01', aud_amount_cents: $(9_000), category_id: 'sal' },
      { date: '2026-10-03', aud_amount_cents: -$(950), category_id: 'groc' },
      { date: '2026-10-05', aud_amount_cents: -$(300), category_id: 'eat' },
      { date: '2026-10-06', aud_amount_cents: -$(200), category_id: 'cafe' },
      { date: '2026-10-07', aud_amount_cents: -$(40), category_id: null },
      { date: '2026-10-08', aud_amount_cents: -$(2_000), category_id: null, is_transfer: true },
      { date: '2026-09-08', aud_amount_cents: -$(999), category_id: 'groc' },
    ],
    categories,
    budgets: [{ category_id: 'groc', monthly_cents: $(900), effective_from: '2026-01-01' }, { category_id: 'eat', monthly_cents: $(600), effective_from: '2026-01-01' }],
    snapshots: [
      { account_id: 'a', aud_balance_cents: $(20_000), date: '2026-09-30' },
      { account_id: 'a', aud_balance_cents: $(27_000), date: '2026-10-31' },
      { account_id: 'b', aud_balance_cents: $(10_000), date: '2026-09-15' },
    ],
    accounts: [{ id: 'a', name: 'Joint' }, { id: 'b', name: 'Saver' }],
    insights: [insight('One', 12), insight('Two', null), insight('Three', -40), insight('Four', null), insight('Five', null), insight('Six', null)],
    subscriptions: [],
    bills: [{ date: '2026-11-20', label: 'Netflix', cents: $(18.99), source: 'detected', ref: 'n', currency: 'AUD', nativeCents: $(18.99) }],
    deposit: { targetCents: $(250_000), byMonth: '2028-03', projectedMonth: '2028-01', monthsLate: -2, valueAtByMonth: null, extraMonthlyCents: 0, currentMonthlyPaceCents: null, eventName: 'Home', currentCents: $(150_000), fhss: { netCents: $(9_024), month: '2028-02' } },
    sacrifice: [{ name: 'Evan', annualCents: $(10_000) }, { name: 'Rachel', annualCents: 0 }],
    fhssOn: true,
    capLines: [],
    homeLoan: null,
    ...over,
  }
}

describe('monthly report data', () => {
  it('net worth change is explained by rows that add up exactly', () => {
    const r = buildMonthlyReport(input())
    expect(r.netWorth.startCents).toBe($(30_000))
    expect(r.netWorth.endCents).toBe($(37_000))
    expect(r.netWorth.changeCents).toBe($(7_000))
    expect(r.netWorth.rows.reduce((s, x) => s + x.cents, 0)).toBe(r.netWorth.changeCents)
    expect(r.netWorth.accounts.find(a => a.name === 'Saver')!.updated).toBe(false)
  })

  it('income vs spending for the chosen month only (transfers out)', () => {
    const r = buildMonthlyReport(input())
    // 950 + 300 + 200 + 40 = 1,490 spent; 9,000 in.
    expect(r.cashflow).toEqual({ incomeCents: $(9_000), spentCents: $(1_490), savedCents: $(7_510), savedPct: 7_510 / 9_000 })
  })

  it('budget results by top-level category, children rolled up, over/under', () => {
    const r = buildMonthlyReport(input())
    const by = Object.fromEntries(r.budgets.lines.map(l => [l.name, l]))
    expect(by.Groceries).toMatchObject({ targetCents: $(900), spentCents: $(950), diffCents: -$(50), status: 'over' })
    expect(by['Eating Out']).toMatchObject({ targetCents: $(600), spentCents: $(500), diffCents: $(100), status: 'under' })
    expect(by.Uncategorised).toMatchObject({ spentCents: $(40), status: 'no_target' })
    expect(by.Fun).toBeUndefined() // no target, no spending
    expect(r.budgets).toMatchObject({ totalTargetCents: $(1_500), totalSpentOnTargetsCents: $(1_450), overCount: 1 })
    expect(r.budgets.lines[0].targetCents).not.toBeNull() // budgeted first
  })

  it('top insights with $ impact and deposit days, at most five', () => {
    const r = buildMonthlyReport(input())
    expect(r.insights).toHaveLength(5)
    expect(r.insights[0]).toMatchObject({ title: 'One', impactLabel: '$100/yr', deposit: 'deposit ~12 days sooner' })
    expect(r.insights[2].deposit).toBe('deposit ~40 days later')
    expect(r.insights[1].deposit).toBeNull()
  })

  it('deposit with the FHSS effect, sacrifice, bills, disclaimer', () => {
    const r = buildMonthlyReport(input())
    expect(r.deposit).toMatchObject({ pct: 60, projectedMonth: '2028-01', fhss: { netCents: $(9_024), month: '2028-02' } })
    expect(r.sacrifice).toEqual([{ name: 'Evan', annualCents: $(10_000) }])
    expect(r.bills).toEqual([{ date: '2026-11-20', label: 'Netflix', cents: $(18.99) }])
    expect(r.disclaimer).toBe(REPORT_DISCLAIMER)
    expect(r.complete).toBe(true)
    expect(buildMonthlyReport(input({ month: '2026-11' })).complete).toBe(false)
  })

  it('home loan summary replaces the deposit when in loan mode', () => {
    const r = buildMonthlyReport(input({
      homeLoan: {
        source: 'account', loanName: 'CBA Home Loan', balanceCents: $(790_000), balanceAsOf: '2028-05-31', offsetName: 'Offset', offsetCents: $(40_000), ratePct: 6,
        effectiveRatePct: 5.7, interestThisMonthCents: $(3_750), savedByOffsetThisMonthCents: $(200), repaymentCents: $(4_800),
        payoff: { months: 300, month: '2053-05', totalInterestCents: 1 }, payoffWithoutOffset: { months: 320, month: '2055-01', totalInterestCents: 2 }, extras: [], notes: [],
      },
    }))
    expect(r.homeLoan).toMatchObject({ balanceCents: $(790_000), payoffMonth: '2053-05', savedByOffsetThisMonthCents: $(200) })
  })

  it('month picker: the last 24 complete months', () => {
    const ms = reportMonths('2026-11')
    expect(ms[0]).toBe('2026-10')
    expect(ms).toHaveLength(24)
    expect(ms[23]).toBe('2024-11')
    expect(reportMonths('2027-01')[0]).toBe('2026-12')
    expect(isReportMonth('2026-10', '2026-11')).toBe(true)
    expect(isReportMonth('2026-11', '2026-11')).toBe(false)
    expect(isReportMonth('2026-13', '2026-11')).toBe(false)
  })
})

describe('monthly report PDF (smoke)', () => {
  it('renders a valid PDF from the report data', async () => {
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { ReportDocument } = await import('./pdf')
    const r = buildMonthlyReport(input())
    const buf = await renderToBuffer(createElement(ReportDocument, { r, logoSrc: null }) as Parameters<typeof renderToBuffer>[0])
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2_000)
  }, 30_000)
})
