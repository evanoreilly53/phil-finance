import { createClient } from '@/lib/supabase/server'
import { resolveAssumptions, resolvePersonAssumptions, ASSUMPTIONS, type AssumptionKey } from '@/lib/assumptions'
import { houseParams, depositAccountIdsFromParams, defaultDepositAccountIds } from '@/lib/projection/inputs'
import { OCCURRENCES_PER_YEAR } from '@/lib/projection/schedule'
import { fhssProjectionMonths } from '@/lib/house/fhss'
import { CONCESSIONAL_SOURCE, contributionsInFy, type ConcessionalRow } from '@/lib/superCap'
import { fyOf } from '@/lib/tax/config'
import { perthToday } from '@/lib/import/dates'
import AssumptionsForm, { type AssumptionField, type HouseForm, type PersonForm } from './AssumptionsForm'

/** Edited in their own section (Salary sacrifice, FHSS and super), not with the rates. */
const OWN_SECTION = new Set<string>(['fhss_use'])

export default async function AssumptionsPage() {
  const supabase = await createClient()
  const [{ data: scenarios }, { data: rows }, { data: events }, { data: people }, { data: salaries }, { data: accounts }, { data: goals }, { data: concessional }] = await Promise.all([
    supabase.from('scenarios').select('id, name, is_baseline, parent_scenario_id').eq('is_archived', false),
    supabase.from('assumptions').select('scenario_id, key, value'),
    supabase.from('life_events').select('id, name, event_date, budget_cents, params, status').eq('kind', 'house_purchase').is('scenario_id', null).neq('status', 'cancelled').order('event_date').limit(1),
    supabase.from('people').select('key, display_name, has_private_hospital, has_hecs').order('sort_order'),
    supabase.from('planned_cashflows').select('person_key, amount_cents, frequency, start_date')
      .eq('kind', 'income').eq('is_gross', true).eq('status', 'planned').is('scenario_id', null),
    supabase.from('accounts').select('id, name, type, currency').eq('is_active', true).order('sort_order').order('name'),
    supabase.from('goals').select('name, target_date').eq('is_active', true),
    supabase.from('planned_cashflows').select('id, person_key, amount_cents, frequency, start_date, end_date, status, description')
      .eq('kind', 'super_contribution').eq('source_table', CONCESSIONAL_SOURCE).neq('status', 'cancelled').is('scenario_id', null),
  ])

  const baseline = (scenarios ?? []).find(s => s.is_baseline) ?? null
  const resolved = resolveAssumptions(baseline?.id ?? '', scenarios ?? [], rows ?? [])
  const fields: AssumptionField[] = (Object.keys(ASSUMPTIONS) as AssumptionKey[]).filter(k => !OWN_SECTION.has(k)).map(k => ({
    key: k, label: ASSUMPTIONS[k].label, unit: ASSUMPTIONS[k].unit, min: ASSUMPTIONS[k].min, max: ASSUMPTIONS[k].max,
    value: resolved[k].value, isDefault: resolved[k].source === 'default',
  }))

  const ev = events?.[0] ?? null
  const hp = ev ? houseParams(ev.params, ev.budget_cents, ev.event_date) : null
  const acctLike = (accounts ?? []).map(a => ({ id: a.id, name: a.name, type: a.type, currency: a.currency }))
  const house: HouseForm | null = ev && hp ? {
    eventId: ev.id, name: ev.name, month: ev.event_date.slice(0, 7),
    priceCents: hp.priceCents, upfrontCents: hp.upfrontCents, costsCents: hp.costsSource === 'entered' ? hp.costsCents : null,
    firstHome: hp.firstHome, propertyKind: hp.propertyKind, useScheme: hp.useScheme,
    rentMonthlyCents: hp.rentMonthlyCents, loanTermMonths: hp.loanTermMonths,
    depositAccountIds: depositAccountIdsFromParams(ev.params) ?? defaultDepositAccountIds(acctLike),
  } : null
  const oldGoal = (goals ?? []).find(g => /house|deposit/i.test(g.name) && g.target_date)

  const today = perthToday()
  const personKeys = (people ?? []).map(p => p.key)
  const perPerson = resolvePersonAssumptions(baseline?.id ?? '', scenarios ?? [], rows ?? [], personKeys)
  const persons: PersonForm[] = (people ?? []).map(p => {
    const mine = (salaries ?? []).filter(s => s.person_key === p.key)
    const gross = mine.reduce((sum, s) => sum + (s.frequency === 'once' ? 0 : Math.abs(s.amount_cents) * OCCURRENCES_PER_YEAR[s.frequency]), 0)
    return {
      key: p.key, name: p.display_name, hasPrivateHospital: p.has_private_hospital, hasHecs: p.has_hecs,
      grossAnnualCents: gross, startDate: mine[0]?.start_date ?? today,
      sacrificeDollars: perPerson[p.key]?.salary_sacrifice.value ?? 0,
      birthMonth: perPerson[p.key]?.birth_month.value ?? 0,
    }
  })
  const concessionalRows = (concessional ?? []) as ConcessionalRow[]
  const enteredConcessional = Object.fromEntries(personKeys.map(k => [k, contributionsInFy(concessionalRows, k, today).reduce((s, e) => s + e.cents, 0)]))

  return (
    <AssumptionsForm
      scenarioName={baseline?.name ?? null}
      fields={fields}
      house={house}
      oldGoal={oldGoal ? { name: oldGoal.name, date: oldGoal.target_date! } : null}
      accounts={acctLike.filter(a => !['super', 'property', 'credit_card', 'mortgage', 'loan', 'other_liability'].includes(a.type))}
      people={persons}
      fy={fyOf(today)}
      fhss={{
        on: resolved.fhss_use.value === 1,
        releaseMonth: house ? fhssProjectionMonths(house.month).releaseMonth : null,
        note: !house ? 'No house purchase in the plan yet, so nothing is released.' : !house.firstHome ? 'FHSS is for first-home buyers: the house is set as not a first home.' : null,
      }}
      enteredConcessional={enteredConcessional}
    />
  )
}
