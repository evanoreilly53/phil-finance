// Scenario assumptions registry + inheritance. Pure.
// Stored as rows (scenario_id, key, value); a forked scenario only stores the
// keys it changes and inherits the rest from its parent chain, then defaults.
// All values are estimates for modelling, not advice; verify before relying.

export type AssumptionDef = { label: string; unit: 'pct' | 'rate'; default: number; min: number; max: number }

export const ASSUMPTIONS = {
  inflation_pct:          { label: 'Inflation',                 unit: 'pct',  default: 3.0,  min: -5, max: 20 },
  wage_growth_pct:        { label: 'Salary growth',             unit: 'pct',  default: 3.5,  min: -10, max: 20 },
  cash_return_pct:        { label: 'Savings interest',          unit: 'pct',  default: 4.5,  min: 0, max: 15 },
  investment_return_pct:  { label: 'Investment return',         unit: 'pct',  default: 7.0,  min: -20, max: 25 },
  super_return_pct:       { label: 'Super return (after fees)', unit: 'pct',  default: 7.0,  min: -20, max: 25 },
  mortgage_rate_pct:      { label: 'Mortgage rate',             unit: 'pct',  default: 6.0,  min: 0, max: 20 },
  house_price_growth_pct: { label: 'House price growth',        unit: 'pct',  default: 4.0,  min: -20, max: 25 },
  super_guarantee_pct:    { label: 'Employer super (SG)',       unit: 'pct',  default: 12.0, min: 0, max: 30 },
  fx_eur_aud:             { label: 'EUR → AUD (fallback)',      unit: 'rate', default: 1.65, min: 0.5, max: 5 },
} as const satisfies Record<string, AssumptionDef>

export type AssumptionKey = keyof typeof ASSUMPTIONS

export function isAssumptionKey(k: string): k is AssumptionKey {
  return Object.prototype.hasOwnProperty.call(ASSUMPTIONS, k)
}

export type ScenarioNode = { id: string; parent_scenario_id: string | null }
export type AssumptionRow = { scenario_id: string; key: string; value: number | string }
export type ResolvedAssumption = { value: number; source: 'scenario' | 'inherited' | 'default'; scenarioId: string | null }

/** Effective assumptions for a scenario: own value → nearest ancestor → default. Unknown keys are ignored. */
export function resolveAssumptions(
  scenarioId: string,
  scenarios: readonly ScenarioNode[],
  rows: readonly AssumptionRow[],
): Record<AssumptionKey, ResolvedAssumption> {
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
    if (!isAssumptionKey(r.key) || !Number.isFinite(v)) continue
    const m = values.get(r.scenario_id) ?? new Map<string, number>()
    m.set(r.key, v)
    values.set(r.scenario_id, m)
  }
  const out = {} as Record<AssumptionKey, ResolvedAssumption>
  for (const key of Object.keys(ASSUMPTIONS) as AssumptionKey[]) {
    const hit = chain.findIndex(id => values.get(id)?.has(key))
    out[key] = hit < 0
      ? { value: ASSUMPTIONS[key].default, source: 'default', scenarioId: null }
      : { value: values.get(chain[hit])!.get(key)!, source: hit === 0 ? 'scenario' : 'inherited', scenarioId: chain[hit] }
  }
  return out
}
