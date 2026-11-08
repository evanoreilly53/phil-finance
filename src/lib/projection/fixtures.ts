// Test fixtures for the projection engine (imported by *.test.ts only).

import { ASSUMPTIONS, type AssumptionKey } from '../assumptions'
import type { Assumptions, ProjAccount, ProjectionInput } from './types'

export const $ = (dollars: number) => Math.round(dollars * 100)

export function assumptions(over: Partial<Assumptions> = {}): Assumptions {
  const out = {} as Assumptions
  for (const k of Object.keys(ASSUMPTIONS) as AssumptionKey[]) out[k] = ASSUMPTIONS[k].default
  return { ...out, ...over }
}

/** Every growth rate zero: only explicit flows move balances. */
export const FLAT = assumptions({
  inflation_pct: 0, wage_growth_pct: 0, cash_return_pct: 0, investment_return_pct: 0,
  super_return_pct: 0, house_price_growth_pct: 0, mortgage_rate_pct: 6,
})

export function account(id: string, type: ProjAccount['type'], balanceDollars: number, over: Partial<ProjAccount> = {}): ProjAccount {
  return {
    id, name: id, type, owner: 'joint', isLiquid: true, currency: 'AUD', balanceCents: $(balanceDollars), balanceAsOf: '2026-11-01',
    interestRatePct: null, expectedReturnPct: null, feePct: null, annualFeeCents: null, loan: null, ...over,
  }
}

export function baseInput(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    today: '2026-11-08',
    startMonth: '2026-12',
    months: 24,
    assumptions: FLAT,
    accounts: [account('joint', 'bank', 10_000)],
    people: [
      { key: 'rachel', name: 'Rachel', hasPrivateHospital: true, hasHecs: false },
      { key: 'evan', name: 'Evan', hasPrivateHospital: true, hasHecs: false },
    ],
    salaries: [],
    netIncomes: [],
    spending: { lines: [], totalMonthlyCents: 0, months: [] },
    cashflows: [],
    events: [],
    fx: { EUR: 1.65 },
    sweepAccountId: 'joint',
    depositAccountIds: ['joint'],
    ...over,
  }
}

export function spending(monthlyDollars: number) {
  return { lines: [{ key: 'groceries', name: 'Groceries', monthlyCents: $(monthlyDollars), averageCents: $(monthlyDollars), budgetCents: null, basis: 'average' as const }], totalMonthlyCents: $(monthlyDollars), months: [] }
}
