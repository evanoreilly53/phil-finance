'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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

// ── Planned outflows ──────────────────────────────────────────────────────────

export type OutflowInput = {
  description: string
  amount_cents: number
  due_date: string
  category?: string | null
  notes?: string | null
  account_id?: string | null
}

export async function addPlannedOutflow(input: OutflowInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('planned_outflows').insert({ ...input, status: 'planned' })
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}

export async function updatePlannedOutflow(id: string, input: OutflowInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('planned_outflows').update(input).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}

export async function markOutflowPaid(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('planned_outflows').update({ status: 'paid' }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/goals')
  revalidatePath('/dashboard')
  return {}
}

export async function deletePlannedOutflow(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('planned_outflows').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}

export async function cancelPlannedOutflow(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('planned_outflows').update({ status: 'cancelled' }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/goals')
  return {}
}
