'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { outflowToCashflow, type OutflowInput } from '@/lib/plannedItems'

// ── Goals ─────────────────────────────────────────────────────────────────────

export type GoalKind = 'net_worth_milestone' | 'net_worth_ultimate' | 'weekly_savings' | 'annual_savings' | 'custom' | null

export type GoalInput = {
  name: string
  kind?: GoalKind
  owner: 'joint' | 'rachel' | 'evan'
  target_cents: number
  current_cents?: number
  cadence?: 'weekly' | 'monthly' | 'annual' | 'one-off' | null
  target_date?: string | null
  sort_order?: number | null
}

export async function addGoal(input: GoalInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('goals').insert({ ...input, is_active: true })
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}

export async function updateGoal(id: string, input: GoalInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('goals').update(input).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}

export async function deleteGoal(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('goals').update({ is_active: false }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}

// ── Upcoming payments ─────────────────────────────────────────────────────────
// Since Phase 3 these are one-off expenses in planned_cashflows (what the
// projection reads). The old planned_outflows table is kept as an archive and
// no longer written.

export type { OutflowInput } from '@/lib/plannedItems'

const PAYMENT_PATHS = ['/goals', '/future', '/dashboard', '/house']
function revalidatePayments() { for (const p of PAYMENT_PATHS) revalidatePath(p) }

async function categoryIdFor(supabase: Awaited<ReturnType<typeof createClient>>, name: string | null | undefined): Promise<string | null> {
  const n = name?.trim()
  if (!n) return null
  const { data } = await supabase.from('categories').select('id, parent_id').ilike('name', n)
  return (data ?? []).sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id))[0]?.id ?? null
}

function validOutflow(input: OutflowInput): string | null {
  if (!input.description?.trim()) return 'Add a description'
  if (!Number.isSafeInteger(input.amount_cents) || input.amount_cents <= 0) return 'Enter a valid amount'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) return 'Pick a date'
  return null
}

/** Only shared one-off expenses can be edited from this list. */
const onlyPayments = <Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(q: Q) =>
  q.eq('kind', 'expense').eq('frequency', 'once').is('scenario_id', null)

export async function addPlannedOutflow(input: OutflowInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const bad = validOutflow(input)
  if (bad) return { error: bad }
  const fields = outflowToCashflow(input, await categoryIdFor(supabase, input.category))
  const { error } = await supabase.from('planned_cashflows').insert({ ...fields, status: 'planned', created_by: user.id })
  if (error) return { error: error.message }
  revalidatePayments()
  return {}
}

export async function updatePlannedOutflow(id: string, input: OutflowInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const bad = validOutflow(input)
  if (bad) return { error: bad }
  const fields = outflowToCashflow(input, await categoryIdFor(supabase, input.category))
  const { error } = await onlyPayments(supabase.from('planned_cashflows').update(fields).eq('id', id))
  if (error) return { error: error.message }
  revalidatePayments()
  return {}
}

async function setStatus(id: string, status: 'paid' | 'cancelled'): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await onlyPayments(supabase.from('planned_cashflows').update({ status }).eq('id', id))
  if (error) return { error: error.message }
  revalidatePayments()
  return {}
}

export async function markOutflowPaid(id: string): Promise<{ error?: string }> { return setStatus(id, 'paid') }
export async function cancelPlannedOutflow(id: string): Promise<{ error?: string }> { return setStatus(id, 'cancelled') }

export async function deletePlannedOutflow(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await onlyPayments(supabase.from('planned_cashflows').delete().eq('id', id))
  if (error) return { error: error.message }
  revalidatePayments()
  return {}
}
