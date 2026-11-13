// Scenario assumptions registry + inheritance. Pure.
// Stored as rows (scenario_id, key, value); a forked scenario only stores the
// keys it changes and inherits the rest from its parent chain, then defaults.
// All values are estimates for modelling, not advice; verify before relying.
//
// Two kinds of key:
//   • household keys (ASSUMPTIONS below), e.g. `inflation_pct`;
//   • per-person keys (PERSON_ASSUMPTIONS), stored as `<base>__<personKey>`,
//     e.g. `salary_sacrifice__evan`. Same table, same inheritance, so a
//     scenario can override one person's salary sacrifice (Phase 5).

export type AssumptionUnit = 'pct' | 'rate' | 'aud' | 'aud_year' | 'flag' | 'yyyymm'
export type AssumptionDef = { label: string; unit: AssumptionUnit; default: number; min: number; max: number }

export const ASSUMPTIONS = {
  inflation_pct:          { label: 'Inflation',                 unit: 'pct',  default: 3.0,  min: -5, max: 20 },
  wage_growth_pct:        { label: 'Salary growth',             unit: 'pct',  default: 3.5,  min: -10, max: 20 },
  cash_return_pct:        { label: 'Savings interest',          unit: 'pct',  default: 4.5,  min: 0, max: 15 },
  investment_return_pct:  { label: 'Investment return',         unit: 'pct',  default: 7.0,  min: -20, max: 25 },
  super_return_pct:       { label: 'Super return (after fees and tax)', unit: 'pct', default: 7.0, min: -20, max: 25 },
  mortgage_rate_pct:      { label: 'Mortgage rate',             unit: 'pct',  default: 6.0,  min: 0, max: 20 },
  house_price_growth_pct: { label: 'House price growth',        unit: 'pct',  default: 4.0,  min: -20, max: 25 },
  super_guarantee_pct:    { label: 'Employer super (SG)',       unit: 'pct',  default: 12.0, min: 0, max: 30 },
  fx_eur_aud:             { label: 'EUR → AUD (fallback)',      unit: 'rate', default: 1.65, min: 0.5, max: 5 },
  // Phase 3 scenario lever: + saves more each month (spend less), − saves less. Whole dollars a month.
  extra_saving_monthly:   { label: 'Extra saving a month',      unit: 'aud',  default: 0,    min: -20_000, max: 20_000 },
  // Phase 5: FHSS on/off (salary sacrifice counts toward FHSS and is released for the house).
  fhss_use:               { label: 'Use FHSS for the house',    unit: 'flag', default: 0,    min: 0, max: 1 },
  // Phase 5: yearly volatility (standard deviation of returns) for the uncertainty band.
  investment_volatility_pct: { label: 'Investment volatility',  unit: 'pct',  default: 16,   min: 0, max: 50 },
  super_volatility_pct:   { label: 'Super volatility',          unit: 'pct',  default: 10,   min: 0, max: 50 },
} as const satisfies Record<string, AssumptionDef>

export type AssumptionKey = keyof typeof ASSUMPTIONS

/** Per-person assumptions; the stored key is `<base>__<personKey>`. */
export const PERSON_ASSUMPTIONS = {
  // Voluntary pre-tax (concessional) contribution, whole dollars a year. Capped by the concessional cap in the projection.
  salary_sacrifice: { label: 'Salary sacrifice', unit: 'aud_year', default: 0, min: 0, max: 30_000 },
  // Birth month as YYYYMM (e.g. 199204), for super to preservation age. 0 = not set.
  birth_month:      { label: 'Born (YYYYMM)',    unit: 'yyyymm',   default: 0, min: 0, max: 210012 },
} as const satisfies Record<string, AssumptionDef>

export type PersonAssumptionBase = keyof typeof PERSON_ASSUMPTIONS

export function isAssumptionKey(k: string): k is AssumptionKey {
  return Object.prototype.hasOwnProperty.call(ASSUMPTIONS, k)
}

export function personAssumptionKey(base: PersonAssumptionBase, personKey: string): string {
  return `${base}__${personKey}`
}

/** `salary_sacrifice__evan` → { base, personKey }; null if not a per-person key. */
export function parsePersonAssumptionKey(k: string): { base: PersonAssumptionBase; personKey: string } | null {
  const i = k.indexOf('__')
  if (i <= 0) return null
  const base = k.slice(0, i), personKey = k.slice(i + 2)
  if (!Object.prototype.hasOwnProperty.call(PERSON_ASSUMPTIONS, base) || !/^[a-z][a-z0-9_]*$/.test(personKey)) return null
  return { base: base as PersonAssumptionBase, personKey }
}

/** The definition behind any stored key (household or per-person), or null. */
export function assumptionDef(k: string): AssumptionDef | null {
  if (isAssumptionKey(k)) return ASSUMPTIONS[k]
  const p = parsePersonAssumptionKey(k)
  return p ? PERSON_ASSUMPTIONS[p.base] : null
}

export function assumptionLabel(k: string, people: readonly { key: string; name: string }[] = []): string {
  if (isAssumptionKey(k)) return ASSUMPTIONS[k].label
  const p = parsePersonAssumptionKey(k)
  if (!p) return k
  return `${people.find(x => x.key === p.personKey)?.name ?? p.personKey}: ${PERSON_ASSUMPTIONS[p.base].label.toLowerCase()}`
}

export type ScenarioNode = { id: string; parent_scenario_id: string | null }
export type AssumptionRow = { scenario_id: string; key: string; value: number | string }
export type ResolvedAssumption = { value: number; source: 'scenario' | 'inherited' | 'default'; scenarioId: string | null }

/** Own value → nearest ancestor → default, for any set of keys. */
function resolveKeys(
  scenarioId: string, scenarios: readonly ScenarioNode[], rows: readonly AssumptionRow[], defaults: Record<string, number>,
): Record<string, ResolvedAssumption> {
  const byId = new Map(scenarios.map(s => [s.id, s]))
  const chain: string[] = []
  const seen = new Set<string>()
  for (let cur: string | null = scenarioId; cur && !seen.has(cur); cur = byId.get(cur)?.parent_scenario_id ?? null) {
    seen.add(cur)
    chain.push(cur)
  }
  const values = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const v = Number(r.value)
    if (!Object.prototype.hasOwnProperty.call(defaults, r.key) || !Number.isFinite(v)) continue
    const m = values.get(r.scenario_id) ?? new Map<string, number>()
    m.set(r.key, v)
    values.set(r.scenario_id, m)
  }
  const out: Record<string, ResolvedAssumption> = {}
  for (const key of Object.keys(defaults)) {
    const hit = chain.findIndex(id => values.get(id)?.has(key))
    out[key] = hit < 0
      ? { value: defaults[key], source: 'default', scenarioId: null }
      : { value: values.get(chain[hit])!.get(key)!, source: hit === 0 ? 'scenario' : 'inherited', scenarioId: chain[hit] }
  }
  return out
}

/** Effective assumptions for a scenario: own value → nearest ancestor → default. Unknown keys are ignored. */
export function resolveAssumptions(
  scenarioId: string,
  scenarios: readonly ScenarioNode[],
  rows: readonly AssumptionRow[],
): Record<AssumptionKey, ResolvedAssumption> {
  const defaults = Object.fromEntries((Object.keys(ASSUMPTIONS) as AssumptionKey[]).map(k => [k, ASSUMPTIONS[k].default]))
  return resolveKeys(scenarioId, scenarios, rows, defaults) as Record<AssumptionKey, ResolvedAssumption>
}

export type PersonAssumptions = Record<PersonAssumptionBase, ResolvedAssumption>

/** Per-person assumptions for each person key, with the same inheritance. */
export function resolvePersonAssumptions(
  scenarioId: string,
  scenarios: readonly ScenarioNode[],
  rows: readonly AssumptionRow[],
  personKeys: readonly string[],
): Record<string, PersonAssumptions> {
  const defaults: Record<string, number> = {}
  for (const pk of personKeys) for (const b of Object.keys(PERSON_ASSUMPTIONS) as PersonAssumptionBase[]) defaults[personAssumptionKey(b, pk)] = PERSON_ASSUMPTIONS[b].default
  const flat = resolveKeys(scenarioId, scenarios, rows, defaults)
  const out: Record<string, PersonAssumptions> = {}
  for (const pk of personKeys) {
    out[pk] = Object.fromEntries((Object.keys(PERSON_ASSUMPTIONS) as PersonAssumptionBase[]).map(b => [b, flat[personAssumptionKey(b, pk)]])) as PersonAssumptions
  }
  return out
}

/** Every editable key for a household: household keys, then each person's keys. */
export function assumptionKeysFor(personKeys: readonly string[]): string[] {
  return [
    ...Object.keys(ASSUMPTIONS),
    ...personKeys.flatMap(pk => (Object.keys(PERSON_ASSUMPTIONS) as PersonAssumptionBase[]).map(b => personAssumptionKey(b, pk))),
  ]
}

/** Label suffix for a unit in forms. */
export function unitSuffix(unit: AssumptionUnit): string {
  return unit === 'pct' ? ' (%)' : unit === 'aud' ? ' ($/mo)' : unit === 'aud_year' ? ' ($/yr)' : unit === 'flag' ? ' (1 = on, 0 = off)' : unit === 'yyyymm' ? ' (YYYYMM)' : ''
}

/** A birth month stored as YYYYMM → 'YYYY-MM' (null when unset or invalid). */
export function birthMonthKey(v: number): string | null {
  if (!Number.isInteger(v) || v < 190001) return null
  const y = Math.floor(v / 100), m = v % 100
  if (m < 1 || m > 12) return null
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * Validate edited assumption values (from the Assumptions form). Unknown keys
 * and blanks are dropped; out-of-range or non-numeric values are errors.
 */
export function validateAssumptionValues(input: Record<string, unknown>):
  { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const [k, raw] of Object.entries(input)) {
    const def = assumptionDef(k)
    if (!def || raw === '' || raw === null || raw === undefined) continue
    const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? Number(raw) : Number(String(raw).trim())
    if (!Number.isFinite(v)) errors[k] = 'Enter a number'
    else if (v < def.min || v > def.max) errors[k] = `Between ${def.min} and ${def.max}`
    else if (def.unit === 'flag' && v !== 0 && v !== 1) errors[k] = 'On (1) or off (0)'
    else if (def.unit === 'yyyymm' && v !== 0 && !birthMonthKey(v)) errors[k] = 'Year and month as YYYYMM, e.g. 199204'
    else values[k] = Math.round(v * 1000) / 1000
  }
  return { values, errors }
}
