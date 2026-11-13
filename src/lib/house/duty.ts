// WA transfer duty on a residential purchase. Pure, integer cents.
// RevenueWA charges duty per $100 "or part thereof": the excess over a band is
// rounded UP to the next $100 before the rate applies.
// Estimate only: RevenueWA assesses the real figure.

import { ruleFor, WA_DUTY, type DutyBand, type FhorScale, type OffThePlanRule, type WaDutyRules } from './rules'

export type PropertyKind = 'established' | 'new' | 'off_the_plan_pre' | 'off_the_plan_under' | 'vacant_land'

export const PROPERTY_KINDS: { value: PropertyKind; label: string }[] = [
  { value: 'established', label: 'Established home' },
  { value: 'new', label: 'New home (never lived in)' },
  { value: 'off_the_plan_pre', label: 'Off the plan, before construction' },
  { value: 'off_the_plan_under', label: 'Off the plan, under construction' },
  { value: 'vacant_land', label: 'Vacant land (to build on)' },
]

export function isPropertyKind(v: unknown): v is PropertyKind {
  return typeof v === 'string' && PROPERTY_KINDS.some(k => k.value === v)
}

/** Number of $100 parts (rounded up) in an amount of cents. */
const parts = (cents: number) => Math.ceil(Math.max(0, cents) / 10_000)
/** Dollars per $100 → cents per part, exactly (5.15 → 515). */
const perPart = (per100: number) => Math.round(per100 * 100)

export function generalDutyCents(valueCents: number, scale: readonly DutyBand[]): number {
  const v = Math.max(0, Math.round(valueCents))
  if (v === 0) return 0
  let band = scale[0]
  for (const b of scale) if (v > b.overCents) band = b
  return band.baseCents + parts(v - band.overCents) * perPart(band.per100)
}

/** First home owner rate, or null when the value is above the cap (general rate applies to the whole value). */
export function fhorDutyCents(valueCents: number, s: FhorScale): number | null {
  const v = Math.max(0, Math.round(valueCents))
  if (v > s.capCents) return null
  if (v <= s.nilToCents) return 0
  return parts(v - s.nilToCents) * perPart(s.per100)
}

/** Off-the-plan concession %, or 0 outside the contract window. */
export function offThePlanPct(valueCents: number, stage: 'pre' | 'under', rule: OffThePlanRule | null, contractDate: string): number {
  if (!rule || contractDate < rule.from || contractDate > rule.to) return 0
  const r = rule[stage]
  if (valueCents <= r.fullToCents) return r.fullPct
  if (valueCents >= r.floorFromCents) return r.floorPct
  return Math.max(r.floorPct, r.fullPct - parts(valueCents - r.fullToCents) * r.taperPctPer100)
}

export type DutyResult = {
  rules: WaDutyRules
  /** Duty at the general rate. */
  generalCents: number
  /** Duty at the first home owner rate, if eligible and under the cap. */
  fhorCents: number | null
  /** Off-the-plan concession (dollars off the general duty), if any. */
  offThePlanConcessionCents: number
  /** What you'd pay: the lowest that applies. */
  payableCents: number
  basis: 'exempt' | 'first_home_rate' | 'off_the_plan' | 'general'
  /** Saving vs the general rate. */
  savingCents: number
  note: string
}

export type DutyInput = {
  priceCents: number
  firstHome: boolean
  kind: PropertyKind
  /** Agreement (contract) date: decides which rules apply. */
  contractDate: string
}

export function waDuty(p: DutyInput, rules: WaDutyRules = ruleFor(WA_DUTY, p.contractDate)): DutyResult {
  const price = Math.max(0, Math.round(p.priceCents))
  const general = generalDutyCents(price, rules.general)
  const scale = p.kind === 'vacant_land' ? rules.fhorLand : rules.fhorHome
  const fhor = p.firstHome ? fhorDutyCents(price, scale) : null
  const stage = p.kind === 'off_the_plan_pre' ? 'pre' : p.kind === 'off_the_plan_under' ? 'under' : null
  const otpPct = stage ? offThePlanPct(price, stage, rules.offThePlan, p.contractDate) : 0
  const otpConcession = otpPct > 0 ? Math.min(rules.offThePlan!.maxConcessionCents, Math.round(general * otpPct / 100)) : 0
  const otpDuty = general - otpConcession

  let payable = general
  let basis: DutyResult['basis'] = 'general'
  if (fhor !== null && fhor <= payable) { payable = fhor; basis = fhor === 0 ? 'exempt' : 'first_home_rate' }
  if (otpConcession > 0 && otpDuty < payable) { payable = otpDuty; basis = otpDuty === 0 ? 'exempt' : 'off_the_plan' }

  const k = (c: number) => `$${Math.round(c / 100).toLocaleString('en-AU')}`
  const note =
    basis === 'exempt' ? (otpConcession > 0 && fhor !== 0 ? 'No duty: full off-the-plan concession' : `No duty: first home ${p.kind === 'vacant_land' ? 'land' : 'home'} up to ${k(scale.nilToCents)}`)
    : basis === 'first_home_rate' ? `First home owner rate: $${scale.per100} per $100 above ${k(scale.nilToCents)} (up to ${k(scale.capCents)})`
    : basis === 'off_the_plan' ? `Off-the-plan concession ${otpPct}% (max ${k(rules.offThePlan!.maxConcessionCents)})`
    : p.firstHome && price > scale.capCents ? `General rate: over the ${k(scale.capCents)} first home cap, so no concession` : 'General rate'

  return { rules, generalCents: general, fhorCents: fhor, offThePlanConcessionCents: otpConcession, payableCents: payable, basis, savingCents: general - payable, note }
}

/** Duty across a price range, for the cliff chart. */
export function dutyCurve(p: Omit<DutyInput, 'priceCents'>, fromCents: number, toCents: number, stepCents: number): { priceCents: number; dutyCents: number; generalCents: number }[] {
  const out: { priceCents: number; dutyCents: number; generalCents: number }[] = []
  for (let v = fromCents; v <= toCents; v += stepCents) {
    const d = waDuty({ ...p, priceCents: v })
    out.push({ priceCents: v, dutyCents: d.payableCents, generalCents: d.generalCents })
  }
  return out
}

/** Prices where duty jumps (thresholds) for the given settings, for chart callouts. */
export function dutyCliffs(p: Omit<DutyInput, 'priceCents'>): { priceCents: number; label: string }[] {
  const rules = ruleFor(WA_DUTY, p.contractDate)
  if (!p.firstHome) return []
  const s = p.kind === 'vacant_land' ? rules.fhorLand : rules.fhorHome
  return [
    { priceCents: s.nilToCents, label: 'First-home duty starts' },
    { priceCents: s.capCents, label: 'First-home rate ends' },
  ]
}
