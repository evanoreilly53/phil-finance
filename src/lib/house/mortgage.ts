// Mortgage maths: P&I repayments, offset and extra repayments. Pure, cents.
// Interest is charged monthly on (balance − offset), at rate ÷ 12. The
// scheduled repayment is fixed at the start (as banks do), so an offset or
// extra repayment shortens the loan rather than lowering the repayment.

import { repaymentFor } from './borrowing'

export type MortgageInput = {
  loanCents: number
  ratePct: number
  termMonths: number
  /** Offset balance at the start. */
  offsetCents?: number
  /** Added to the offset every month (savings parked there). */
  offsetMonthlyAddCents?: number
  extraMonthlyCents?: number
}

export type MortgageYear = { year: number; balanceCents: number; interestCents: number; offsetCents: number }

export type MortgageResult = {
  repaymentCents: number        // scheduled P&I (without extra)
  paymentCents: number          // what you pay each month incl. extra
  months: number                // to pay off
  totalInterestCents: number
  years: MortgageYear[]
}

export function mortgageSchedule(p: MortgageInput): MortgageResult {
  const loan = Math.max(0, Math.round(p.loanCents))
  const repayment = repaymentFor(loan, p.ratePct, p.termMonths)
  const payment = repayment + Math.max(0, Math.round(p.extraMonthlyCents ?? 0))
  const r = p.ratePct / 100 / 12
  let bal = loan
  let offset = Math.max(0, Math.round(p.offsetCents ?? 0))
  const add = Math.max(0, Math.round(p.offsetMonthlyAddCents ?? 0))
  let total = 0
  let yearInterest = 0
  let months = 0
  const years: MortgageYear[] = []
  const cap = Math.max(p.termMonths, 1) + 1
  while (bal > 0 && months < cap) {
    const interest = Math.round(Math.max(0, bal - offset) * r)
    let pay = Math.min(payment, bal + interest)
    // Cent rounding can leave a few dollars at the end: clear them with the last payment.
    const left = bal + interest - pay
    if (left > 0 && left < Math.max(100, payment / 100)) pay = bal + interest
    bal = bal + interest - pay
    total += interest
    yearInterest += interest
    months++
    offset += add
    if (months % 12 === 0 || bal <= 0) {
      years.push({ year: Math.ceil(months / 12), balanceCents: Math.max(0, bal), interestCents: yearInterest, offsetCents: offset })
      yearInterest = 0
    }
  }
  return { repaymentCents: repayment, paymentCents: payment, months, totalInterestCents: total, years }
}

export type MortgageCompare = {
  base: MortgageResult
  withExtras: MortgageResult
  interestSavedCents: number
  monthsSaved: number
}

/** The plain loan vs the same loan with offset and/or extra repayments. */
export function compareMortgage(p: MortgageInput): MortgageCompare {
  const base = mortgageSchedule({ loanCents: p.loanCents, ratePct: p.ratePct, termMonths: p.termMonths })
  const withExtras = mortgageSchedule(p)
  return { base, withExtras, interestSavedCents: base.totalInterestCents - withExtras.totalInterestCents, monthsSaved: base.months - withExtras.months }
}

/** Repayment at the plan rate and with rate rises (rate shock). */
export function rateShock(loanCents: number, ratePct: number, termMonths: number, rises: readonly number[] = [1, 2, 3]) {
  return [0, ...rises].map(d => ({ ratePct: Math.round((ratePct + d) * 100) / 100, repaymentCents: repaymentFor(loanCents, ratePct + d, termMonths) }))
}
