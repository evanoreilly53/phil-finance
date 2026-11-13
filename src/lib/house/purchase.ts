// Upfront cost of buying a home in WA: deposit, duty, fees, LMI, grants, and
// the loan and LVR that result. Pure, integer cents. Estimates only.

import { waDuty, type DutyResult, type PropertyKind } from './duty'
import {
  DEPOSIT_SCHEME, LANDGATE_2026_27, LMI_ESTIMATE, OTHER_COSTS_ESTIMATE, ruleFor, WA_FHOG,
  type DepositSchemeRules, type FhogRules,
} from './rules'

// ── Fees ──────────────────────────────────────────────────────────────────────

export function landgateTransferFeeCents(valueCents: number): number {
  const L = LANDGATE_2026_27
  for (const b of L.transferBands) if (valueCents <= b.toCents) return b.feeCents
  const top = L.transferBands[L.transferBands.length - 1]
  return top.feeCents + Math.ceil((valueCents - top.toCents) / 10_000_000) * L.stepPer100kCents
}

// ── LMI (indicative) ──────────────────────────────────────────────────────────

export type LmiEstimate = { premiumCents: number; dutyCents: number; totalCents: number; ratePct: number; lvrPct: number; overMaxLvr: boolean }

/** Indicative LMI on a loan. 0 at or below 80% LVR. Above 95% lenders generally won't lend. */
export function lmiEstimate(loanCents: number, priceCents: number): LmiEstimate {
  const lvrPct = priceCents > 0 ? (loanCents / priceCents) * 100 : 0
  const band = LMI_ESTIMATE.bands.find(b => lvrPct <= b.lvrToPct + 1e-9)
  const overMaxLvr = !band
  const base = (band ?? LMI_ESTIMATE.bands[LMI_ESTIMATE.bands.length - 1]).premiumPct
  const ratePct = base * (loanCents > LMI_ESTIMATE.largeLoanFromCents && base > 0 ? LMI_ESTIMATE.largeLoanLoading : 1)
  const premium = Math.round(loanCents * ratePct / 100)
  const duty = Math.round(premium * LMI_ESTIMATE.stampDutyPct / 100)
  return { premiumCents: premium, dutyCents: duty, totalCents: premium + duty, ratePct: Math.round(ratePct * 100) / 100, lvrPct, overMaxLvr }
}

// ── Grants and schemes ────────────────────────────────────────────────────────

export type Eligibility = { eligible: boolean; reasons: string[] }

export function fhogEligibility(p: { priceCents: number; firstHome: boolean; kind: PropertyKind; contractDate: string; northOf26th?: boolean }, rules: FhogRules = ruleFor(WA_FHOG, p.contractDate)): Eligibility & { amountCents: number; capCents: number } {
  const cap = p.northOf26th ? rules.capNorthCents : rules.capSouthCents
  const reasons: string[] = []
  if (!p.firstHome) reasons.push('Only for first home owners')
  if (p.kind === 'established') reasons.push('Established homes don’t qualify: new homes and builds only')
  if (p.priceCents > cap) reasons.push(`Over the $${(cap / 100).toLocaleString('en-AU')} value cap`)
  const eligible = reasons.length === 0
  return { eligible, reasons, amountCents: eligible ? rules.amountCents : 0, capCents: cap }
}

export function depositSchemeEligibility(p: { priceCents: number; depositCents: number; firstHome: boolean; contractDate: string; area?: 'perth' | 'rest_of_wa' }, rules: DepositSchemeRules = ruleFor(DEPOSIT_SCHEME, p.contractDate)): Eligibility & { capCents: number; minDepositCents: number } {
  const cap = p.area === 'rest_of_wa' ? rules.capRestOfWaCents : rules.capPerthCents
  const minDeposit = Math.ceil(p.priceCents * rules.minDepositPct / 100)
  const reasons: string[] = []
  if (!p.firstHome) reasons.push('First home buyers (or no property in the last 10 years) only')
  if (p.priceCents > cap) reasons.push(`Over the $${(cap / 100).toLocaleString('en-AU')} price cap`)
  if (p.depositCents < minDeposit) reasons.push(`Needs at least a ${rules.minDepositPct}% deposit`)
  return { eligible: reasons.length === 0, reasons, capCents: cap, minDepositCents: minDeposit }
}

// ── The whole purchase ────────────────────────────────────────────────────────

export type PurchaseInput = {
  priceCents: number
  /** Cash you'll put in at settlement: deposit + duty + fees (+ LMI if not added to the loan). */
  cashCents: number
  firstHome: boolean
  kind: PropertyKind
  contractDate: string
  /** Use the 5% Deposit Scheme if eligible (no LMI). */
  useScheme: boolean
  area?: 'perth' | 'rest_of_wa'
}

export type CostLine = { key: string; label: string; cents: number; estimate?: boolean; note?: string }

export type PurchaseResult = {
  priceCents: number
  cashCents: number
  duty: DutyResult
  fees: CostLine[]
  feesCents: number
  lmi: LmiEstimate
  /** True when the 5% scheme was used to avoid LMI. */
  schemeApplied: boolean
  scheme: ReturnType<typeof depositSchemeEligibility>
  fhog: ReturnType<typeof fhogEligibility>
  /** Duty + fees + LMI − FHOG: money that doesn't become equity. */
  costsCents: number
  depositCents: number
  loanCents: number
  lvrPct: number
  /** Cash left over if the deposit would exceed the price (rare). */
  leftoverCents: number
  problems: string[]
  lines: CostLine[]
}

/**
 * Split the cash available into deposit and costs. LMI depends on the deposit
 * (through the LVR), so the split is solved by iteration; it settles in a few
 * rounds because LMI only steps at band edges.
 */
export function purchase(p: PurchaseInput): PurchaseResult {
  const price = Math.max(0, Math.round(p.priceCents))
  const cash = Math.max(0, Math.round(p.cashCents))
  const duty = waDuty({ priceCents: price, firstHome: p.firstHome, kind: p.kind, contractDate: p.contractDate })
  const fees: CostLine[] = [
    { key: 'transfer', label: 'Landgate transfer registration', cents: landgateTransferFeeCents(price) },
    { key: 'mortgage', label: 'Mortgage registration', cents: LANDGATE_2026_27.mortgageRegistrationCents },
    { key: 'settlement', label: 'Settlement agent (typical)', cents: OTHER_COSTS_ESTIMATE.settlementAgentCents, estimate: true },
    { key: 'inspection', label: 'Building and pest inspection (typical)', cents: p.kind === 'established' ? OTHER_COSTS_ESTIMATE.buildingPestCents : 0, estimate: true },
  ].filter(f => f.cents > 0)
  const feesCents = fees.reduce((s, f) => s + f.cents, 0)
  const fhog = fhogEligibility({ priceCents: price, firstHome: p.firstHome, kind: p.kind, contractDate: p.contractDate })

  const fixed = duty.payableCents + feesCents - fhog.amountCents
  const at = (d: number) => {
    const l = lmiEstimate(Math.max(0, price - d), price)
    const s = depositSchemeEligibility({ priceCents: price, depositCents: d, firstHome: p.firstHome, contractDate: p.contractDate, area: p.area })
    const applied = p.useScheme && s.eligible && l.lvrPct > 80
    return { l, s, applied, cost: applied ? 0 : l.totalCents }
  }
  let deposit = Math.max(0, cash - fixed)
  const seen = new Set<number>()
  for (let i = 0; i < 20; i++) {
    const next = Math.max(0, cash - fixed - at(deposit).cost)
    if (next === deposit) break
    // Flipping across an LVR band edge: settle on the smaller (safer) deposit.
    if (seen.has(next)) { deposit = Math.min(deposit, next); break }
    seen.add(deposit)
    deposit = next
  }
  const final = at(deposit)
  const scheme = final.s
  const schemeApplied = final.applied
  const lmi = schemeApplied ? { ...final.l, premiumCents: 0, dutyCents: 0, totalCents: 0 } : final.l

  const leftover = Math.max(0, deposit - price)
  deposit = Math.min(deposit, price)
  const loan = price - deposit
  const lvrPct = price > 0 ? (loan / price) * 100 : 0

  const problems: string[] = []
  if (cash < fixed) problems.push('Cash doesn’t cover duty and fees, let alone a deposit')
  else if (lvrPct > 95 + 1e-9) problems.push('Deposit under 5%: lenders generally won’t lend above 95% LVR')
  if (p.useScheme && !scheme.eligible && lvrPct > 80) problems.push(`5% scheme not available: ${scheme.reasons.join('; ')}`)

  const lines: CostLine[] = [
    { key: 'deposit', label: 'Deposit', cents: deposit },
    { key: 'duty', label: 'Transfer duty', cents: duty.payableCents, note: duty.note },
    ...fees,
    ...(lmi.totalCents > 0 ? [{ key: 'lmi', label: `LMI (indicative, ${lmi.ratePct}% + 10% duty)`, cents: lmi.totalCents, estimate: true }] : []),
    ...(fhog.amountCents > 0 ? [{ key: 'fhog', label: 'First Home Owner Grant', cents: -fhog.amountCents }] : []),
  ]

  return {
    priceCents: price, cashCents: cash, duty, fees, feesCents, lmi, schemeApplied, scheme, fhog,
    costsCents: duty.payableCents + feesCents + lmi.totalCents - fhog.amountCents,
    depositCents: deposit, loanCents: loan, lvrPct, leftoverCents: leftover, problems, lines,
  }
}

/** Cash needed at settlement for a given deposit % (inverse of `purchase`). */
export function cashNeededFor(p: Omit<PurchaseInput, 'cashCents'> & { depositPct: number }): number {
  const price = Math.max(0, Math.round(p.priceCents))
  const deposit = Math.ceil(price * p.depositPct / 100)
  const duty = waDuty({ priceCents: price, firstHome: p.firstHome, kind: p.kind, contractDate: p.contractDate })
  const fees = landgateTransferFeeCents(price) + LANDGATE_2026_27.mortgageRegistrationCents + OTHER_COSTS_ESTIMATE.settlementAgentCents +
    (p.kind === 'established' ? OTHER_COSTS_ESTIMATE.buildingPestCents : 0)
  const fhog = fhogEligibility({ priceCents: price, firstHome: p.firstHome, kind: p.kind, contractDate: p.contractDate }).amountCents
  const scheme = depositSchemeEligibility({ priceCents: price, depositCents: deposit, firstHome: p.firstHome, contractDate: p.contractDate, area: p.area })
  const lmi = p.useScheme && scheme.eligible ? 0 : lmiEstimate(price - deposit, price).totalCents
  return deposit + duty.payableCents + fees + lmi - fhog
}
