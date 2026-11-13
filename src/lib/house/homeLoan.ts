// Home Loan mode (Phase 5). Pure, cents.
//
// After the purchase month, or once you've marked the house as bought, Home
// and House track the mortgage instead of the deposit. Real data wins: a
// mortgage account (Track › Accounts) with its latest balance, rate,
// repayment and linked offset account. Without one, the plan is used: the loan
// the purchase would have drawn, amortised from the purchase month to now at
// the plan's rate, with the chosen offset account's current balance.
//
// Interest is charged monthly on (balance − offset) at rate ÷ 12; the offset
// earns nothing itself. Payoff dates assume the repayment and the offset
// balance stay as they are today (savings parked in the offset would make it
// sooner). Estimates, not lender figures.

import { annuityPayment } from '../projection/engine'
import { addMonthsKey, monthDiff, OCCURRENCES_PER_YEAR } from '../projection/schedule'
import type { HouseParams, ProjAccount } from '../projection/types'

export type Payoff = { months: number; month: string; totalInterestCents: number } | null

/**
 * Months to clear `balanceCents` paying `paymentCents` a month with a fixed
 * offset. Null if the payment doesn't cover the interest (never paid off) or
 * it takes over 100 years.
 */
export function payoff(balanceCents: number, ratePct: number, paymentCents: number, offsetCents: number, fromMonth: string): Payoff {
  let bal = Math.max(0, Math.round(balanceCents))
  if (bal === 0) return { months: 0, month: fromMonth, totalInterestCents: 0 }
  const r = ratePct / 100 / 12
  const offset = Math.max(0, Math.round(offsetCents))
  let months = 0, total = 0
  while (bal > 0) {
    if (months >= 1200) return null
    const interest = Math.round(Math.max(0, bal - offset) * r)
    if (paymentCents <= interest) return null
    const pay = Math.min(paymentCents, bal + interest)
    bal = bal + interest - pay
    total += interest
    months++
  }
  return { months, month: addMonthsKey(fromMonth, months - 1), totalInterestCents: total }
}

/** Balance after `months` of repayments (offset held constant). */
export function balanceAfter(balanceCents: number, ratePct: number, paymentCents: number, offsetCents: number, months: number): number {
  let bal = Math.max(0, Math.round(balanceCents))
  const r = ratePct / 100 / 12
  for (let i = 0; i < months && bal > 0; i++) {
    const interest = Math.round(Math.max(0, bal - Math.max(0, offsetCents)) * r)
    bal = Math.max(0, bal + interest - Math.min(paymentCents, bal + interest))
  }
  return bal
}

export type HomeLoanStatus = {
  source: 'account' | 'plan'
  loanName: string
  /** What's owed (positive). */
  balanceCents: number
  balanceAsOf: string | null
  offsetName: string | null
  offsetCents: number
  ratePct: number
  /** Rate on the whole balance after the offset: rate × (balance − offset) ÷ balance. */
  effectiveRatePct: number
  interestThisMonthCents: number
  savedByOffsetThisMonthCents: number
  repaymentCents: number
  payoff: Payoff
  payoffWithoutOffset: Payoff
  extras: { extraCents: number; payoff: Payoff; monthsSaved: number | null; interestSavedCents: number | null }[]
  notes: string[]
}

export type HomeLoanInput = {
  thisMonth: string
  /** Real accounts with their latest balances (loans negative). */
  accounts: readonly ProjAccount[]
  house: { date: string; status: string; params: HouseParams }
  mortgageRatePct: number
  /** What-if extra repayments to show (a month). */
  extras?: readonly number[]
}

/** Home Loan mode applies once the purchase month has come, or the house is marked bought. */
export function isLoanMode(house: { date: string; status: string } | null, thisMonth: string): boolean {
  if (!house || house.status === 'cancelled') return false
  return house.status === 'done' || house.date.slice(0, 7) <= thisMonth
}

function monthlyRepayment(acc: ProjAccount, owed: number, ratePct: number, thisMonth: string, fallbackTerm: number): number {
  const l = acc.loan
  if (l?.repaymentCents && l.repaymentFreq) return Math.round(l.repaymentCents * OCCURRENCES_PER_YEAR[l.repaymentFreq] / 12)
  if (l?.interestOnly) return Math.round(owed * ratePct / 100 / 12)
  const left = l?.startDate && l.termMonths ? l.termMonths - monthDiff(l.startDate.slice(0, 7), thisMonth) : fallbackTerm
  return annuityPayment(owed, ratePct, Math.max(1, left))
}

export function homeLoanStatus(p: HomeLoanInput): HomeLoanStatus {
  const byId = new Map(p.accounts.map(a => [a.id, a]))
  const notes: string[] = []
  const h = p.house.params
  const real = p.accounts
    .filter(a => a.type === 'mortgage' && !a.synthetic && a.balanceCents < 0)
    .sort((x, y) => x.balanceCents - y.balanceCents)[0] ?? null

  let source: HomeLoanStatus['source'], loanName: string, balance: number, asOf: string | null, rate: number, repayment: number, offsetId: string | null
  if (real) {
    source = 'account'
    loanName = real.name
    balance = -real.balanceCents
    asOf = real.balanceAsOf
    rate = real.interestRatePct ?? p.mortgageRatePct
    if (real.interestRatePct === null) notes.push(`No rate recorded on ${real.name}: using the plan's ${p.mortgageRatePct}%.`)
    repayment = monthlyRepayment(real, balance, rate, p.thisMonth, h.loanTermMonths)
    if (!real.loan?.repaymentCents) notes.push('No repayment recorded on the loan account: using the standard repayment for what is left of the term.')
    offsetId = real.loan?.offsetAccountId ?? h.offsetAccountId
  } else {
    source = 'plan'
    loanName = 'Mortgage (from the plan)'
    rate = p.mortgageRatePct
    const drawn = Math.max(0, h.priceCents - (h.upfrontCents - Math.min(h.costsCents, h.upfrontCents)))
    const scheduled = annuityPayment(drawn, rate, h.loanTermMonths)
    repayment = scheduled + h.extraRepaymentMonthlyCents
    offsetId = h.offsetAccountId
    const elapsed = Math.max(0, monthDiff(p.house.date.slice(0, 7), p.thisMonth))
    const offsetNow = Math.max(0, offsetId ? byId.get(offsetId)?.balanceCents ?? 0 : 0)
    balance = balanceAfter(drawn, rate, repayment, offsetNow, elapsed)
    asOf = null
    notes.push('No mortgage account yet: these figures come from the plan. Add the loan in Track › Accounts (type Mortgage, with its offset) to track the real balance.')
  }

  const offsetAcc = offsetId ? byId.get(offsetId) ?? null : null
  const offset = Math.max(0, offsetAcc?.balanceCents ?? 0)
  const r = rate / 100 / 12
  const charged = Math.max(0, balance - offset)
  const extras = (p.extras ?? [25_000, 50_000, 100_000]).filter(x => x > 0)
  const base = payoff(balance, rate, repayment, offset, p.thisMonth)
  return {
    source, loanName, balanceCents: balance, balanceAsOf: asOf,
    offsetName: offsetAcc?.name ?? null, offsetCents: offset, ratePct: rate,
    effectiveRatePct: balance > 0 ? Math.round(rate * charged / balance * 100) / 100 : 0,
    interestThisMonthCents: Math.round(charged * r),
    savedByOffsetThisMonthCents: Math.round(Math.min(offset, balance) * r),
    repaymentCents: repayment,
    payoff: base,
    payoffWithoutOffset: payoff(balance, rate, repayment, 0, p.thisMonth),
    extras: extras.map(x => {
      const e = payoff(balance, rate, repayment + x, offset, p.thisMonth)
      return {
        extraCents: x, payoff: e,
        monthsSaved: base && e ? base.months - e.months : null,
        interestSavedCents: base && e ? base.totalInterestCents - e.totalInterestCents : null,
      }
    }),
    notes,
  }
}
