// Indicative borrowing power: a simple serviceability test, NOT a lender
// assessment. Each lender uses its own income shading, expense benchmark
// (HEM), buffer floors and credit policy, and answers can differ by $100k+.
//
// Method: after-tax income (from the take-home engine) − living expenses (the
// higher of your actual spending and a HEM-style floor) − other debt
// repayments = monthly surplus. The most that surplus could repay over the
// term at (your rate + APRA's 3-point buffer) is the estimate. A range is
// given by also testing expenses 15% higher. The DTI 6× line is a flag, not a cap.

import { annualTakeHome } from '../tax/takeHome'
import type { FyKey } from '../tax/config'
import { SERVICEABILITY } from './rules'

export type BorrowPerson = { name: string; grossCents: number; hasPrivateHospital: boolean; hasHecs: boolean }

export type BorrowInput = {
  people: BorrowPerson[]
  fy: FyKey
  /** Your actual monthly living spending, excluding rent that stops when you buy. */
  livingMonthlyCents: number
  /** Repayments on other debts that continue (car loans, credit cards). */
  otherDebtMonthlyCents: number
  /** Other debt balances (for DTI). */
  otherDebtBalanceCents: number
  ratePct: number
  termMonths: number
  bufferPctPoints?: number
  hemFloorMonthlyCents?: number
}

export type BorrowResult = {
  netMonthlyCents: number
  grossAnnualCents: number
  expensesMonthlyCents: number
  expenseBasis: 'actual' | 'hem_floor'
  assessedRatePct: number
  surplusMonthlyCents: number
  /** Range: expenses +15% (low) to as-entered (high). */
  lowCents: number
  highCents: number
  /** 6 × gross income less other debts. */
  dti6Cents: number
  /** Repayment on `highCents` at your actual rate (not the buffered one). */
  repaymentAtHighCents: number
}

/** Present value of a monthly payment stream (the loan a repayment supports). */
export function loanForRepayment(monthlyCents: number, annualRatePct: number, months: number): number {
  if (monthlyCents <= 0 || months <= 0) return 0
  const r = annualRatePct / 100 / 12
  if (r === 0) return Math.round(monthlyCents * months)
  return Math.round(monthlyCents * (1 - Math.pow(1 + r, -months)) / r)
}

export function repaymentFor(loanCents: number, annualRatePct: number, months: number): number {
  if (loanCents <= 0) return 0
  const r = annualRatePct / 100 / 12
  if (r === 0) return Math.round(loanCents / months)
  return Math.round(loanCents * r / (1 - Math.pow(1 + r, -months)))
}

export function borrowingPower(p: BorrowInput): BorrowResult {
  const combined = p.people.reduce((s, x) => s + Math.max(0, x.grossCents), 0)
  const couple = p.people.length >= 2
  const netAnnual = p.people.reduce((s, x) => s + annualTakeHome({
    grossCents: x.grossCents, hasPrivateHospital: x.hasPrivateHospital, hasHecs: x.hasHecs,
    family: couple ? { combinedIncomeCents: combined } : undefined,
  }, p.fy).netCents, 0)
  const netMonthly = Math.round(netAnnual / 12)
  const floor = p.hemFloorMonthlyCents ?? SERVICEABILITY.hemCoupleMonthlyCents
  const expenses = Math.max(p.livingMonthlyCents, floor)
  const assessed = p.ratePct + (p.bufferPctPoints ?? SERVICEABILITY.bufferPctPoints)
  const surplus = netMonthly - expenses - p.otherDebtMonthlyCents
  const surplusLow = netMonthly - Math.round(expenses * 1.15) - p.otherDebtMonthlyCents
  const high = loanForRepayment(surplus, assessed, p.termMonths)
  return {
    netMonthlyCents: netMonthly,
    grossAnnualCents: combined,
    expensesMonthlyCents: expenses,
    expenseBasis: p.livingMonthlyCents >= floor ? 'actual' : 'hem_floor',
    assessedRatePct: Math.round(assessed * 1000) / 1000,
    surplusMonthlyCents: surplus,
    lowCents: loanForRepayment(surplusLow, assessed, p.termMonths),
    highCents: high,
    dti6Cents: Math.max(0, combined * SERVICEABILITY.dtiFlag - p.otherDebtBalanceCents),
    repaymentAtHighCents: repaymentFor(high, p.ratePct, p.termMonths),
  }
}
