'use server'

// Named scenarios: create, duplicate, rename, archive, and edit a scenario's
// overrides (assumptions, its own house plan, leave). The baseline's house is
// the shared plan (scenario_id NULL); any other scenario gets its own copy the
// first time you change its house, so editing a what-if never touches the
// baseline.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { ASSUMPTIONS, assumptionDef, assumptionLabel, validateAssumptionValues, type AssumptionKey } from '@/lib/assumptions'
import { mergeHouseParams, mergeHouseSettings, validateHouseEdit, houseParams, depositAccountIdsFromParams, type HouseSettingsEdit } from '@/lib/projection/inputs'
import { scenarioChain, selectScenarioEvents, exampleScenarios } from '@/lib/projection/scenarios'
import { addMonthsKey, monthEnd } from '@/lib/projection/schedule'
import { perthToday } from '@/lib/import/dates'
import type { Json } from '@/lib/supabase/database.types'

type Result = { error?: string; id?: string }

const PLAN_PATHS = ['/future', '/future/scenarios', '/house', '/dashboard', '/goals', '/more/assumptions', '/networth']
function revalidatePlan() { for (const p of PLAN_PATHS) revalidatePath(p) }

async function auth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}
type Ctx = Awaited<ReturnType<typeof auth>> & { user: NonNullable<Awaited<ReturnType<typeof auth>>['user']> }

const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 80)
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

async function baselineId(ctx: Ctx): Promise<string | null> {
  const { data } = await ctx.supabase.from('scenarios').select('id').eq('is_baseline', true).maybeSingle()
  return data?.id ?? null
}

// ── Create / duplicate / rename / archive ─────────────────────────────────────

export async function createScenario(name: string, parentId?: string | null): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const n = cleanName(name)
  if (!n) return { error: 'Give it a name' }
  const parent = parentId ?? await baselineId(ctx as Ctx)
  if (!parent) return { error: 'No baseline scenario yet: run migration 0008 first.' }
  const { data, error } = await ctx.supabase.from('scenarios')
    .insert({ name: n, parent_scenario_id: parent, created_by: ctx.user.id, sort_order: 10 }).select('id').single()
  if (error) return { error: error.message }
  revalidatePlan()
  return { id: data.id }
}

/** Copy a scenario: same parent, its own assumption rows, events and planned items. */
export async function duplicateScenario(id: string): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const { supabase, user } = ctx
  const { data: src } = await supabase.from('scenarios').select('id, name, description, is_baseline, parent_scenario_id').eq('id', id).maybeSingle()
  if (!src) return { error: 'Scenario not found' }
  // Copying the baseline makes a fork of it (a child), not a second baseline.
  const parent = src.is_baseline ? src.id : src.parent_scenario_id
  const { data: copy, error } = await supabase.from('scenarios')
    .insert({ name: cleanName(`${src.name} (copy)`), description: src.description, parent_scenario_id: parent, created_by: user.id, sort_order: 10 }).select('id').single()
  if (error) return { error: error.message }
  if (!src.is_baseline) {
    const [{ data: rows }, { data: events }, { data: flows }] = await Promise.all([
      supabase.from('assumptions').select('key, value, notes').eq('scenario_id', id),
      supabase.from('life_events').select('name, kind, event_date, end_date, status, currency, budget_cents, params, notes, sort_order, id').eq('scenario_id', id),
      supabase.from('planned_cashflows').select('*').eq('scenario_id', id),
    ])
    if (rows?.length) {
      const { error: e } = await supabase.from('assumptions').insert(rows.map(r => ({ ...r, scenario_id: copy.id, updated_by: user.id })))
      if (e) return { error: e.message }
    }
    const eventMap = new Map<string, string>()
    for (const ev of events ?? []) {
      const { id: oldId, ...rest } = ev
      const { data: ne, error: e } = await supabase.from('life_events').insert({ ...rest, scenario_id: copy.id, created_by: user.id }).select('id').single()
      if (e) return { error: e.message }
      eventMap.set(oldId, ne.id)
    }
    for (const f of flows ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, created_at: _c, source_table: _st, source_id: _sid, ...rest } = f
      const { error: e } = await supabase.from('planned_cashflows').insert({
        ...rest, scenario_id: copy.id, event_id: rest.event_id ? eventMap.get(rest.event_id) ?? rest.event_id : null, created_by: user.id,
      })
      if (e) return { error: e.message }
    }
  }
  revalidatePlan()
  return { id: copy.id }
}

export async function renameScenario(id: string, name: string, description: string): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const n = cleanName(name)
  if (!n) return { error: 'Give it a name' }
  const { error } = await ctx.supabase.from('scenarios').update({ name: n, description: description.trim().slice(0, 300) || null }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePlan()
  return {}
}

/** Archive (hide) a scenario. Its rows stay in the database. The baseline can't be archived. */
export async function archiveScenario(id: string): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const { data: s } = await ctx.supabase.from('scenarios').select('is_baseline').eq('id', id).maybeSingle()
  if (!s) return { error: 'Scenario not found' }
  if (s.is_baseline) return { error: 'The baseline is your real plan and can’t be archived' }
  const { error } = await ctx.supabase.from('scenarios').update({ is_archived: true }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePlan()
  return {}
}

// ── Overrides ─────────────────────────────────────────────────────────────────

/**
 * Set a scenario's assumption overrides. A key with '' (blank) removes the
 * override so the value is inherited again. Keys not given are left alone.
 */
export async function saveScenarioAssumptions(id: string, input: Record<string, string>): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const blanks = Object.entries(input).filter(([k, v]) => assumptionDef(k) && String(v).trim() === '').map(([k]) => k)
  const { values, errors } = validateAssumptionValues(input)
  if (Object.keys(errors).length) return { error: Object.entries(errors).map(([k, e]) => `${assumptionLabel(k)}: ${e}`).join('; ') }
  const { data: s } = await ctx.supabase.from('scenarios').select('is_baseline').eq('id', id).maybeSingle()
  if (!s) return { error: 'Scenario not found' }
  const rows = Object.entries(values).map(([key, value]) => ({ scenario_id: id, key, value, updated_by: ctx.user!.id, updated_at: new Date().toISOString() }))
  if (rows.length) {
    const { error } = await ctx.supabase.from('assumptions').upsert(rows, { onConflict: 'scenario_id,key' })
    if (error) return { error: error.message }
  }
  // The baseline keeps a value for every key (the app default when blank), so only forks drop overrides.
  if (blanks.length && !s.is_baseline) {
    const { error } = await ctx.supabase.from('assumptions').delete().eq('scenario_id', id).in('key', blanks)
    if (error) return { error: error.message }
  }
  revalidatePlan()
  return {}
}

export type HousePatch = HouseSettingsEdit & {
  month?: string
  priceCents?: number
  upfrontCents?: number
}

/**
 * Change the house plan as a scenario sees it. Baseline → the shared house
 * event. Any other scenario → its own house event (copied from the one it
 * inherits the first time).
 */
export async function saveScenarioHouse(scenarioId: string | null, patch: HousePatch): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const { supabase, user } = ctx
  if (patch.month !== undefined && !MONTH.test(patch.month)) return { error: 'Pick a month' }

  const [{ data: scenarios }, { data: events }] = await Promise.all([
    supabase.from('scenarios').select('id, parent_scenario_id, is_baseline').eq('is_archived', false),
    supabase.from('life_events').select('id, scenario_id, name, kind, status, event_date, budget_cents, params, notes').eq('kind', 'house_purchase').eq('is_archived', false),
  ])
  const baseline = (scenarios ?? []).find(s => s.is_baseline)
  const sid = scenarioId ?? baseline?.id ?? null
  const isBaseline = !sid || sid === baseline?.id
  const chain = scenarioChain(sid, scenarios ?? [])
  const current = selectScenarioEvents(events ?? [], chain).find(e => e.kind === 'house_purchase' && e.status !== 'cancelled') ?? null
  if (!current) return { error: 'No house plan to change: add one in More › Assumptions first.' }

  const hp = houseParams(current.params, current.budget_cents, current.event_date)
  if (!hp) return { error: 'The house plan has no price yet' }
  const edit = {
    priceCents: patch.priceCents ?? hp.priceCents,
    upfrontCents: patch.upfrontCents ?? hp.upfrontCents,
    costsCents: hp.costsSource === 'entered' && patch.priceCents === undefined ? hp.costsCents : null,
    rentMonthlyCents: hp.rentMonthlyCents,
    loanTermMonths: hp.loanTermMonths,
    depositAccountIds: depositAccountIdsFromParams(current.params) ?? [],
    ...patch,
  }
  const invalid = validateHouseEdit(edit)
  if (invalid) return { error: invalid }
  let params = mergeHouseSettings(mergeHouseParams(current.params, edit), patch)
  if (!depositAccountIdsFromParams(current.params)) { const { deposit_account_ids: _drop, ...rest } = params; void _drop; params = rest }
  const fields = {
    event_date: patch.month ? `${patch.month}-01` : current.event_date,
    budget_cents: edit.upfrontCents,
    params: params as Json,
  }

  const ownsIt = isBaseline ? current.scenario_id === null : current.scenario_id === sid
  if (ownsIt) {
    const { error } = await supabase.from('life_events').update(fields).eq('id', current.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('life_events').insert({
      ...fields, scenario_id: sid, name: current.name, kind: 'house_purchase', status: 'planned', currency: 'AUD',
      notes: 'This scenario’s own house plan (the baseline’s is unchanged).', created_by: user.id,
    })
    if (error) return { error: error.message }
  }
  revalidatePlan()
  return {}
}

/** Drop a scenario's own house plan so it uses the baseline's again. */
export async function resetScenarioHouse(scenarioId: string): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const { error } = await ctx.supabase.from('life_events').update({ is_archived: true }).eq('scenario_id', scenarioId).eq('kind', 'house_purchase')
  if (error) return { error: error.message }
  revalidatePlan()
  return {}
}

export type LeaveEdit = { personKey: string; startMonth: string; months: number; payPct: number }

/** A scenario's leave (one income for a while). null removes it. */
export async function saveScenarioLeave(scenarioId: string, leave: LeaveEdit | null): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const { supabase, user } = ctx
  const { data: s } = await supabase.from('scenarios').select('is_baseline').eq('id', scenarioId).maybeSingle()
  if (!s) return { error: 'Scenario not found' }
  if (s.is_baseline) return { error: 'Add leave to a what-if scenario, not the baseline' }
  const { data: existing } = await supabase.from('life_events').select('id').eq('scenario_id', scenarioId).eq('kind', 'leave').eq('is_archived', false)
  if (!leave) {
    if (existing?.length) {
      const { error } = await supabase.from('life_events').update({ is_archived: true }).in('id', existing.map(e => e.id))
      if (error) return { error: error.message }
    }
    revalidatePlan()
    return {}
  }
  if (!MONTH.test(leave.startMonth)) return { error: 'Pick a start month' }
  if (!Number.isInteger(leave.months) || leave.months < 1 || leave.months > 60) return { error: 'Leave must be 1–60 months' }
  if (!Number.isFinite(leave.payPct) || leave.payPct < 0 || leave.payPct > 100) return { error: 'Pay must be 0–100%' }
  const { data: person } = await supabase.from('people').select('display_name').eq('key', leave.personKey).maybeSingle()
  if (!person) return { error: 'Pick a person' }
  const fields = {
    name: `${person.display_name} on leave (${leave.payPct}% pay)`,
    event_date: `${leave.startMonth}-01`,
    end_date: monthEnd(addMonthsKey(leave.startMonth, leave.months - 1)),
    params: { person_key: leave.personKey, pay_pct: leave.payPct } as Json,
  }
  const [keep, ...extra] = existing ?? []
  if (keep) {
    const { error } = await supabase.from('life_events').update(fields).eq('id', keep.id)
    if (error) return { error: error.message }
    if (extra.length) await supabase.from('life_events').update({ is_archived: true }).in('id', extra.map(e => e.id))
  } else {
    const { error } = await supabase.from('life_events').insert({ ...fields, scenario_id: scenarioId, kind: 'leave', status: 'planned', created_by: user.id })
    if (error) return { error: error.message }
  }
  revalidatePlan()
  return {}
}

// ── What-if → scenario, and the example set ──────────────────────────────────

export type WhatIf = {
  name: string
  parentId: string | null
  assumptions: Partial<Record<AssumptionKey, number>>
  house: HousePatch | null
}

/** "Save as scenario" from the Future sliders. */
export async function saveWhatIfAsScenario(w: WhatIf): Promise<Result> {
  const created = await createScenario(w.name, w.parentId)
  if (created.error || !created.id) return created
  const vals = Object.fromEntries(Object.entries(w.assumptions).map(([k, v]) => [k, String(v)]))
  if (Object.keys(vals).length) {
    const r = await saveScenarioAssumptions(created.id, vals)
    if (r.error) return r
  }
  if (w.house && Object.keys(w.house).length) {
    const r = await saveScenarioHouse(created.id, w.house)
    if (r.error) return r
  }
  return { id: created.id }
}

/** Add the suggested example scenarios (skips any whose name already exists). */
export async function seedExampleScenarios(): Promise<Result> {
  const ctx = await auth()
  if (!ctx.user) return { error: 'Not authenticated' }
  const { supabase } = ctx
  const [{ data: scenarios }, { data: house }, { data: people }] = await Promise.all([
    supabase.from('scenarios').select('id, name, is_baseline').eq('is_archived', false),
    supabase.from('life_events').select('event_date').eq('kind', 'house_purchase').is('scenario_id', null).neq('status', 'cancelled').eq('is_archived', false).order('event_date').limit(1).maybeSingle(),
    supabase.from('people').select('key').order('sort_order'),
  ])
  const baseline = (scenarios ?? []).find(s => s.is_baseline)
  if (!baseline) return { error: 'No baseline scenario yet: run migration 0008 first.' }
  const { data: rate } = await supabase.from('assumptions').select('value').eq('scenario_id', baseline.id).eq('key', 'mortgage_rate_pct').maybeSingle()
  const seeds = exampleScenarios({
    houseMonth: house?.event_date.slice(0, 7) ?? null,
    mortgageRatePct: Number(rate?.value ?? ASSUMPTIONS.mortgage_rate_pct.default),
    today: perthToday(),
  })
  const names = new Set((scenarios ?? []).map(s => s.name))
  for (const seed of seeds) {
    if (names.has(seed.name)) continue
    const c = await createScenario(seed.name, baseline.id)
    if (c.error || !c.id) return c
    await supabase.from('scenarios').update({ description: seed.description }).eq('id', c.id)
    if (Object.keys(seed.assumptions).length) {
      const r = await saveScenarioAssumptions(c.id, Object.fromEntries(Object.entries(seed.assumptions).map(([k, v]) => [k, String(v)])))
      if (r.error) return r
    }
    if (seed.house) {
      const r = await saveScenarioHouse(c.id, { month: seed.house.month, priceCents: seed.house.priceCents, upfrontCents: seed.house.upfrontCents, useScheme: seed.house.useScheme })
      if (r.error) return r
    }
    const person = seed.leave ? (people ?? [])[seed.leave.personIndex] ?? (people ?? [])[0] : null
    if (seed.leave && person) {
      const r = await saveScenarioLeave(c.id, { personKey: person.key, startMonth: seed.leave.startMonth, months: seed.leave.months, payPct: seed.leave.payPct })
      if (r.error) return r
    }
  }
  revalidatePlan()
  return {}
}
