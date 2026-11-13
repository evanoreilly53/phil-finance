'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateAssumptionValues } from '@/lib/assumptions'
import { mergeHouseParams, validateHouseEdit, type HouseEdit } from '@/lib/projection/inputs'
import type { Json } from '@/lib/supabase/database.types'

type Result = { error?: string; fieldErrors?: Record<string, string> }

const PLAN_PATHS = ['/more/assumptions', '/future', '/dashboard', '/goals', '/networth', '/income']
function revalidatePlan() { for (const p of PLAN_PATHS) revalidatePath(p) }

async function auth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

/** Save baseline scenario assumptions (only the keys given). */
export async function saveAssumptions(input: Record<string, string>): Promise<Result> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  const { values, errors } = validateAssumptionValues(input)
  if (Object.keys(errors).length) return { error: 'Check the highlighted values', fieldErrors: errors as Record<string, string> }
  const { data: baseline, error: sErr } = await supabase.from('scenarios').select('id').eq('is_baseline', true).maybeSingle()
  if (sErr) return { error: sErr.message }
  if (!baseline) return { error: 'No baseline scenario yet: run migration 0008 first.' }
  const rows = Object.entries(values).map(([key, value]) => ({ scenario_id: baseline.id, key, value, updated_by: user.id, updated_at: new Date().toISOString() }))
  if (rows.length) {
    const { error } = await supabase.from('assumptions').upsert(rows, { onConflict: 'scenario_id,key' })
    if (error) return { error: error.message }
  }
  revalidatePlan()
  return {}
}

/** Edit the house purchase event: date, price, upfront cash, costs, rent, loan term, deposit accounts. */
export async function saveHouse(eventId: string, month: string, edit: HouseEdit): Promise<Result> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Pick a month' }
  const invalid = validateHouseEdit(edit)
  if (invalid) return { error: invalid }
  const { data: ev, error: rErr } = await supabase.from('life_events').select('params').eq('id', eventId).eq('kind', 'house_purchase').maybeSingle()
  if (rErr) return { error: rErr.message }
  if (!ev) return { error: 'House event not found' }
  const { error } = await supabase.from('life_events').update({
    event_date: `${month}-01`,
    budget_cents: edit.upfrontCents,
    params: mergeHouseParams(ev.params, edit) as Json,
  }).eq('id', eventId)
  if (error) return { error: error.message }
  revalidatePlan()
  return {}
}

/**
 * Set a person's gross salary (excluding super). Stored as a planned cashflow
 * (kind income, is_gross, annual) that the tax engine reads. 0 cancels it.
 */
export async function saveSalary(personKey: string, grossAnnualCents: number, startDate: string): Promise<Result> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  if (!Number.isSafeInteger(grossAnnualCents) || grossAnnualCents < 0 || grossAnnualCents > 100_000_000) return { error: 'Enter a yearly salary' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: 'Pick a start date' }
  const { data: person } = await supabase.from('people').select('key, display_name').eq('key', personKey).maybeSingle()
  if (!person) return { error: 'Unknown person' }

  const { data: existing, error: eErr } = await supabase.from('planned_cashflows').select('id')
    .eq('person_key', personKey).eq('kind', 'income').eq('is_gross', true).eq('status', 'planned').is('scenario_id', null)
  if (eErr) return { error: eErr.message }
  const [keep, ...extra] = existing ?? []

  if (grossAnnualCents === 0) {
    if (existing?.length) {
      const { error } = await supabase.from('planned_cashflows').update({ status: 'cancelled' }).in('id', existing.map(e => e.id))
      if (error) return { error: error.message }
    }
  } else if (keep) {
    const { error } = await supabase.from('planned_cashflows')
      .update({ amount_cents: grossAnnualCents, frequency: 'annual', start_date: startDate, indexation: 'wages' }).eq('id', keep.id)
    if (error) return { error: error.message }
    if (extra.length) {
      const { error: xErr } = await supabase.from('planned_cashflows').update({ status: 'cancelled' }).in('id', extra.map(e => e.id))
      if (xErr) return { error: xErr.message }
    }
  } else {
    const { error } = await supabase.from('planned_cashflows').insert({
      description: `${person.display_name}: salary (gross, excl. super)`, kind: 'income', person_key: personKey,
      amount_cents: grossAnnualCents, currency: 'AUD', is_gross: true, frequency: 'annual', start_date: startDate,
      indexation: 'wages', created_by: user.id,
    })
    if (error) return { error: error.message }
  }
  revalidatePlan()
  return {}
}

/** Private hospital cover (Medicare Levy Surcharge) and HECS/HELP flags. */
export async function savePersonFlags(personKey: string, flags: { hasPrivateHospital: boolean; hasHecs: boolean }): Promise<Result> {
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('people')
    .update({ has_private_hospital: !!flags.hasPrivateHospital, has_hecs: !!flags.hasHecs }).eq('key', personKey)
  if (error) return { error: error.message }
  revalidatePlan()
  return {}
}
