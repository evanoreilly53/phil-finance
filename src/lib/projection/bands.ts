// Uncertainty bands for investments and super (Phase 5). Pure, deterministic,
// no random numbers: an analytic lognormal approximation layered on top of the
// deterministic projection, which stays the main line.
//
// Method ("cohorts"):
//   • Each class (investments, super) is split into cohorts of money: the
//     opening balance, then each month's net new money (contributions less
//     withdrawals). Withdrawals shrink every cohort in proportion.
//   • Each cohort grows along the deterministic path (so the band's mean is
//     exactly the deterministic line).
//   • A cohort invested for h years is treated as lognormal with the same
//     mean. With an annual return r and volatility σ, the log-variance per year
//     is s² = ln(1 + σ²/(1+r)²), and its percentile q sits at
//         mean × exp(−h·s²/2 + z_q·s·√h)          (z₁₀ = −1.2816, z₉₀ = +1.2816)
//   • A class's percentile is the sum of its cohorts' percentiles. That treats
//     cohorts as moving together (they share most of the same years), which
//     makes the band slightly WIDER than a full simulation would: on purpose,
//     an estimate should not look more certain than it is.
//   • Net worth's band = cash, property and debts (deterministic) + the
//     investments band + the super band, again summed as if they move together.
// Planning estimate, not a forecast or advice.

import { INVEST_TYPES } from './engine'
import type { Projection } from './types'

export const Z90 = 1.2815515655446004

export type ClassReturn = { returnPct: number; volatilityPct: number }

/** Percentile of a lognormal growth factor relative to its mean, after `years`. */
export function lognormalRatio(years: number, c: ClassReturn, z: number): number {
  if (years <= 0 || c.volatilityPct <= 0) return 1
  const r = c.returnPct / 100, sd = c.volatilityPct / 100
  const s2 = Math.log(1 + (sd * sd) / ((1 + r) * (1 + r)))
  return Math.exp(-years * s2 / 2 + z * Math.sqrt(s2 * years))
}

export type Band = { p10: number; p50: number; p90: number; mean: number }

/**
 * Bands for one class of money given its monthly balances (opening first) and
 * the growth credited in each month (returns less fees). Cents in, cents out.
 */
export function cohortBands(balances: readonly number[], growth: readonly number[], c: ClassReturn): Band[] {
  type Cohort = { amt: number; months: number }
  let cohorts: Cohort[] = [{ amt: Math.max(0, balances[0] ?? 0), months: 0 }]
  const out: Band[] = []
  const band = (): Band => {
    let p10 = 0, p50 = 0, p90 = 0, mean = 0
    for (const k of cohorts) {
      const y = k.months / 12
      mean += k.amt
      p10 += k.amt * lognormalRatio(y, c, -Z90)
      p50 += k.amt * lognormalRatio(y, c, 0)
      p90 += k.amt * lognormalRatio(y, c, Z90)
    }
    return { p10: Math.round(Math.max(0, p10)), p50: Math.round(p50), p90: Math.round(p90), mean: Math.round(mean) }
  }
  out.push(band())
  for (let t = 1; t < balances.length; t++) {
    const prev = cohorts.reduce((s, k) => s + k.amt, 0)
    const g = growth[t] ?? 0
    const rate = prev > 0 ? g / prev : 0
    for (const k of cohorts) { k.amt *= 1 + rate; k.months++ }
    const total = prev + (prev > 0 ? g : 0)
    const flow = balances[t] - total
    if (flow > 0) cohorts.push({ amt: flow, months: 0 })
    else if (flow < 0) {
      const scale = total > 0 ? Math.max(0, (total + flow) / total) : 0
      for (const k of cohorts) k.amt *= scale
      cohorts = cohorts.filter(k => k.amt > 0.5)
    }
    if (balances[t] <= 0) cohorts = []
    out.push(band())
  }
  return out
}

export type BandPoint = {
  month: string             // 'now' for the opening balances
  invest: Band
  super: Band
  netWorth: Band
}

/** p10 / p50 / p90 for investments, super and net worth, per projected month. */
export function projectionBands(p: Projection, rates: { invest: ClassReturn; super: ClassReturn }): BandPoint[] {
  const ids = (pred: (type: string) => boolean) => new Set(p.accounts.filter(a => pred(a.type)).map(a => a.id))
  const investIds = ids(t => INVEST_TYPES.has(t))
  const superIds = ids(t => t === 'super')
  const series = (set: Set<string>) => {
    const sum = (b: Record<string, number>) => [...set].reduce((s, id) => s + (b[id] ?? 0), 0)
    const bal = [sum(p.opening.balances), ...p.months.map(m => sum(m.balances))]
    const growth = [0, ...p.months.map(m => m.trace.filter(t => t.accountId && set.has(t.accountId) && (t.kind === 'growth' || t.kind === 'fees')).reduce((s, t) => s + t.cents, 0))]
    return { bal, growth }
  }
  const inv = series(investIds), sup = series(superIds)
  const ib = cohortBands(inv.bal, inv.growth, rates.invest)
  const sb = cohortBands(sup.bal, sup.growth, rates.super)
  const nw = [p.opening.netWorthCents, ...p.months.map(m => m.netWorthCents)]
  const months = ['now', ...p.months.map(m => m.month)]
  return months.map((month, i) => {
    // Anything not investments or super (cash, property, debts) is deterministic.
    const rest = nw[i] - inv.bal[i] - sup.bal[i]
    return {
      month,
      invest: ib[i],
      super: sb[i],
      netWorth: {
        p10: rest + ib[i].p10 + sb[i].p10, p50: rest + ib[i].p50 + sb[i].p50, p90: rest + ib[i].p90 + sb[i].p90,
        mean: nw[i],
      },
    }
  })
}
