// First Home Super Saver (FHSS) vs saving the same money as cash. Pure, cents.
//
// FHSS path: salary-sacrifice C a year into super (taxed 15% in the fund;
// the ATO releases 85% of it) + deemed earnings at the shortfall interest
// charge rate, then tax at your marginal rate (incl. Medicare) less a 30%
// offset on release.
// Cash path: take the same C as salary instead, pay income tax + Medicare,
// save the rest in cash earning interest (interest also taxed at your
// marginal rate).
// Both start from the same pre-tax dollars, so the difference is the FHSS gain.
// Model of the published rules, not advice; the ATO's determination is what counts.

import { annualTakeHome } from '../tax/takeHome'
import { fyOf, type FyKey } from '../tax/config'
import { addMonthsKey, monthDiff, monthStart } from '../projection/schedule'
import { FHSS } from './rules'

export type FhssPerson = {
  name: string
  grossCents: number
  hasPrivateHospital: boolean
  hasHecs: boolean
  /** Salary sacrifice already in place (counts toward the concessional cap). */
  existingSacrificeCents?: number
}

export type FhssInput = {
  person: FhssPerson
  /** First month contributions can be made (YYYY-MM). */
  startMonth: string
  /** Month the money is released (must be before you sign). Contributions run up to the month before. */
  releaseMonth: string
  /** Target voluntary concessional contribution per financial year. */
  annualContributionCents: number
  cashRatePct: number
  sicRatePct?: number
  /** Already counted toward the $50k lifetime limit. */
  priorCountedCents?: number
}

export type FhssFyRow = {
  fy: FyKey
  months: number
  contributionCents: number
  /** Concessional cap room left after SG + existing salary sacrifice. */
  capRoomCents: number
  limitedBy: 'target' | 'fhss_fy_cap' | 'concessional_cap' | 'lifetime_cap' | null
  /** What the contribution costs you in take-home pay (its after-tax value). */
  takeHomeCostCents: number
  marginalRatePct: number
}

export type FhssResult = {
  rows: FhssFyRow[]
  contributedCents: number
  /** 85% of concessional contributions. */
  releasableContribCents: number
  deemedEarningsCents: number
  releasedCents: number
  releaseTaxCents: number
  netFhssCents: number
  /** Same pre-tax dollars taken as pay, saved in cash with after-tax interest. */
  cashPathCents: number
  gainCents: number
  takeHomeCostCents: number
  sicRatePct: number
  warnings: string[]
}

export function fhssVsCash(p: FhssInput): FhssResult {
  const sic = p.sicRatePct ?? FHSS.sicRatePct
  const sacrifice0 = Math.max(0, Math.round(p.person.existingSacrificeCents ?? 0))
  const warnings: string[] = []
  const span = monthDiff(p.startMonth, p.releaseMonth)
  if (span <= 0) return empty(sic, ['The release month is before contributions could start.'])

  // Months in the contribution window, grouped by financial year.
  const monthsByFy = new Map<FyKey, string[]>()
  for (let i = 0; i < span; i++) {
    const mk = addMonthsKey(p.startMonth, i)
    const fy = fyOf(monthStart(mk))
    monthsByFy.set(fy, [...(monthsByFy.get(fy) ?? []), mk])
  }

  let lifetimeLeft = Math.max(0, FHSS.lifetimeCapCents - (p.priorCountedCents ?? 0))
  const rows: FhssFyRow[] = []
  const monthly = new Map<string, { contrib: number; afterTax: number; cashTaxRate: number }>()
  const person = { grossCents: p.person.grossCents, hasPrivateHospital: p.person.hasPrivateHospital, hasHecs: p.person.hasHecs }

  for (const [fy, months] of monthsByFy) {
    const base = annualTakeHome({ ...person, salarySacrificeCents: sacrifice0 }, fy)
    const capRoom = Math.max(0, base.capHeadroomCents)
    const target = Math.max(0, Math.round(p.annualContributionCents))
    let c = target
    let limitedBy: FhssFyRow['limitedBy'] = null
    if (c > FHSS.perFyCapCents) { c = FHSS.perFyCapCents; limitedBy = 'fhss_fy_cap' }
    if (c > capRoom) { c = capRoom; limitedBy = 'concessional_cap' }
    if (c > lifetimeLeft) { c = lifetimeLeft; limitedBy = 'lifetime_cap' }
    lifetimeLeft -= c
    const withSac = annualTakeHome({ ...person, salarySacrificeCents: sacrifice0 + c }, fy)
    const afterTax = base.netCents - withSac.netCents
    const cashTaxRate = base.marginalRate + 0.02
    rows.push({ fy, months: months.length, contributionCents: c, capRoomCents: capRoom, limitedBy: c < target ? limitedBy : null, takeHomeCostCents: afterTax, marginalRatePct: Math.round(base.marginalRate * 100) })
    // Spread evenly over the FY's months in the window (the last month takes the rounding).
    let given = 0, givenAfter = 0
    months.forEach((mk, i) => {
      const last = i === months.length - 1
      const contrib = last ? c - given : Math.round(c / months.length)
      const after = last ? afterTax - givenAfter : Math.round(afterTax / months.length)
      given += contrib; givenAfter += after
      monthly.set(mk, { contrib, afterTax: after, cashTaxRate })
    })
  }

  // Month by month: FHSS balance earns deemed earnings at SIC; cash earns after-tax interest.
  const rSic = sic / 100 / 12
  let fhssBal = 0, contributed = 0, cash = 0
  for (let i = 0; i < span; i++) {
    const mk = addMonthsKey(p.startMonth, i)
    const m = monthly.get(mk)!
    fhssBal += Math.round(fhssBal * rSic)
    cash += Math.round(cash * (p.cashRatePct / 100 / 12) * (1 - m.cashTaxRate))
    fhssBal += m.contrib
    contributed += m.contrib
    cash += m.afterTax
  }
  const earnings = fhssBal - contributed
  const releasableContrib = Math.round(contributed * FHSS.concessionalReleasePct / 100)
  const released = releasableContrib + earnings

  // Tax on release, in the release FY: extra tax from adding the amount, less the 30% offset (non-refundable).
  const relFy = fyOf(monthStart(p.releaseMonth))
  const relSac = sacrifice0 + (rows.find(r => r.fy === relFy)?.contributionCents ?? 0)
  const without = annualTakeHome({ ...person, salarySacrificeCents: relSac }, relFy)
  const withRel = annualTakeHome({ ...person, grossCents: person.grossCents + released, salarySacrificeCents: relSac }, relFy)
  const extraTax = withRel.totalTaxCents - without.totalTaxCents
  const releaseTax = Math.max(0, extraTax - Math.round(released * FHSS.releaseOffsetPct / 100))
  const net = released - releaseTax

  if (rows.some(r => r.limitedBy === 'concessional_cap')) warnings.push('Limited by the concessional cap: employer super already uses most of it.')
  if (rows.some(r => r.limitedBy === 'lifetime_cap')) warnings.push('Limited by the $50,000 lifetime FHSS limit.')

  const takeHomeCost = rows.reduce((s, r) => s + r.takeHomeCostCents, 0)
  return {
    rows, contributedCents: contributed, releasableContribCents: releasableContrib, deemedEarningsCents: earnings,
    releasedCents: released, releaseTaxCents: releaseTax, netFhssCents: net, cashPathCents: cash,
    gainCents: net - cash, takeHomeCostCents: takeHomeCost, sicRatePct: sic, warnings,
  }
}

function empty(sic: number, warnings: string[]): FhssResult {
  return {
    rows: [], contributedCents: 0, releasableContribCents: 0, deemedEarningsCents: 0, releasedCents: 0, releaseTaxCents: 0,
    netFhssCents: 0, cashPathCents: 0, gainCents: 0, takeHomeCostCents: 0, sicRatePct: sic, warnings,
  }
}

/** Key dates for using FHSS on a purchase in `signMonth`. */
export function fhssTimeline(signMonth: string, today: string) {
  // Request the determination and release about two months before signing (release takes ~15–20 business days).
  const requestBy = addMonthsKey(signMonth, -2)
  const lastFy = fyOf(monthStart(addMonthsKey(requestBy, -1)))
  const firstFy = fyOf(today)
  const fys: FyKey[] = []
  for (let y = Number(firstFy.slice(2, 6)); y <= Number(lastFy.slice(2, 6)); y++) fys.push(fyOf(`${y}-07-01`))
  return { requestBy, fys, signWindowBeforeDays: FHSS.signWindowBeforeDays, signWindowAfterMonths: FHSS.signWindowAfterMonths, notifyWithinDays: FHSS.notifyWithinDays }
}
