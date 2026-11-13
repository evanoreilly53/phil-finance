import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '@/lib/supabase/server'
import { fetchPlanData, buildPlan } from '@/lib/projection/load'
import { diffAssumptions, diffHouse } from '@/lib/projection/scenarios'
import { ASSUMPTIONS, type AssumptionKey } from '@/lib/assumptions'
import { Caveat } from '@/components/planUi'
import ScenarioList, { type ScenarioCard } from './ScenarioList'

export default async function ScenariosPage() {
  const supabase = await createClient()
  const data = await fetchPlanData(supabase)
  const baseline = buildPlan(data)
  const houseOf = (p: typeof baseline) => (p.house ? { date: p.house.date, params: p.house.house } : null)
  const ownRows = new Map<string, Set<string>>()
  for (const r of data.assumptionRows) {
    const s = ownRows.get(r.scenario_id) ?? new Set<string>()
    s.add(r.key)
    ownRows.set(r.scenario_id, s)
  }

  const cards: ScenarioCard[] = [...data.scenarios].sort((a, b) => Number(b.is_baseline) - Number(a.is_baseline)).map(s => {
    const plan = s.is_baseline ? baseline : buildPlan(data, { scenarioId: s.id })
    const own = ownRows.get(s.id) ?? new Set()
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      isBaseline: s.is_baseline,
      parentName: data.scenarios.find(p => p.id === s.parent_scenario_id)?.name ?? null,
      diffs: s.is_baseline ? [] : [
        ...diffAssumptions(baseline.assumptions, plan.assumptions).map(d => `${d.label}: ${d.from} → ${d.to}`),
        ...diffHouse(houseOf(baseline), houseOf(plan)).map(d => `${d.field}: ${d.from} → ${d.to}`),
        ...plan.leaves.filter(l => l.scenarioId).map(l => l.name),
      ],
      assumptions: (Object.keys(ASSUMPTIONS) as AssumptionKey[]).map(k => ({
        key: k, label: ASSUMPTIONS[k].label, unit: ASSUMPTIONS[k].unit,
        value: plan.assumptions[k].value, own: own.has(k),
      })),
      house: plan.house ? {
        own: plan.house.scenarioId === s.id || (s.is_baseline && plan.house.scenarioId === null),
        month: plan.house.date.slice(0, 7), priceCents: plan.house.house.priceCents, upfrontCents: plan.house.house.upfrontCents,
        kind: plan.house.house.propertyKind, firstHome: plan.house.house.firstHome, useScheme: plan.house.house.useScheme,
      } : null,
      leave: plan.leaves.find(l => l.scenarioId === s.id) ?? null,
    }
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-300">
        Each scenario is a copy of the baseline with a few things changed: rates, the house plan, or time off work.
        Your real data is never changed by a scenario. Compare them on <Link href={'/future#compare' as Route} className="text-indigo-400">Future</Link>.
      </p>
      <ScenarioList cards={cards} people={baseline.people.map(p => ({ key: p.key, name: p.name }))} />
      <Caveat>Scenarios are what-ifs on your own numbers, not forecasts or advice.</Caveat>
    </div>
  )
}
