'use server'

// Check-in actions: Done / Snooze / "That's intentional" on insight cards,
// tracking or dismissing detected subscriptions, and confirming suggested
// budget targets. States are per household (insight_states, migration 0010).

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { perthMonthKey } from '@/lib/format'
import { addDays, perthToday } from '@/lib/import/dates'
import { DETECTED_SUBSCRIPTION_SOURCE } from '@/lib/plannedItems'
import type { Cadence } from '@/lib/subscriptions/detect'

type Result = { error?: string }

const PATHS = ['/dashboard', '/insights', '/track/bills', '/settings', '/more/budgets', '/future']
function revalidate() { for (const p of PATHS) revalidatePath(p) }

const NO_TABLE = 'Run migration 0010 in Supabase to remember this (see the Phase 4 notes).'
const ISO = /^\d{4}-\d{2}-\d{2}$/
const KEY_OK = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= 300

async function auth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function tableMissing(message: string) {
  return /insight_states|relation .* does not exist|schema cache/i.test(message)
}

export type InsightAction = { kind: 'done' } | { kind: 'snooze'; until: string } | { kind: 'intentional' } | { kind: 'clear' }

export async function setInsightState(key: string, action: InsightAction): Promise<Result> {
  if (!KEY_OK(key)) return { error: 'Unknown item' }
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  if (action.kind === 'clear') {
    const { error } = await supabase.from('insight_states').delete().eq('key', key).eq('scope', 'insight')
    if (error) return { error: tableMissing(error.message) ? NO_TABLE : error.message }
    revalidate()
    return {}
  }
  const today = perthToday()
  let row: { state: 'done' | 'snoozed' | 'intentional'; done_month: string | null; snooze_until: string | null }
  if (action.kind === 'done') row = { state: 'done', done_month: perthMonthKey(), snooze_until: null }
  else if (action.kind === 'intentional') row = { state: 'intentional', done_month: null, snooze_until: null }
  else {
    if (!ISO.test(action.until) || action.until <= today || action.until > addDays(today, 731)) return { error: 'Pick a date within the next two years' }
    row = { state: 'snoozed', done_month: null, snooze_until: action.until }
  }
  const { error } = await supabase.from('insight_states').upsert(
    { key, scope: 'insight', ...row, created_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (error) return { error: tableMissing(error.message) ? NO_TABLE : error.message }
  revalidate()
  return {}
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export type TrackInput = {
  key: string
  merchant: string
  amountCents: number
  cadence: Cadence
  nextDue: string
  categoryId: string | null
}

const CADENCES: readonly Cadence[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'annual']

/**
 * "Track as planned item": a recurring planned_cashflows expense, marked as
 * already in your spending (the projection's spending average includes it),
 * so it shows on the Bills calendar and in Settings › Recurring without being
 * counted twice. Untick "Already in our spending" there for a brand-new one.
 */
export async function trackSubscription(input: TrackInput): Promise<Result> {
  if (!KEY_OK(input.key)) return { error: 'Unknown subscription' }
  if (!CADENCES.includes(input.cadence)) return { error: 'Unknown frequency' }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 10_000_000) return { error: 'Check the amount' }
  if (!ISO.test(input.nextDue)) return { error: 'Check the date' }
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }

  const { data: existing, error: sErr } = await supabase.from('insight_states').select('state, ref_id').eq('key', input.key).maybeSingle()
  if (sErr) return { error: tableMissing(sErr.message) ? NO_TABLE : sErr.message }
  if (existing?.state === 'tracked' && existing.ref_id) return {}

  const { data: row, error } = await supabase.from('planned_cashflows').insert({
    description: input.merchant.trim().slice(0, 80) || 'Subscription',
    kind: 'expense', amount_cents: -Math.abs(input.amountCents), currency: 'AUD', is_gross: false,
    frequency: input.cadence, start_date: input.nextDue, category_id: input.categoryId, status: 'planned',
    source_table: DETECTED_SUBSCRIPTION_SOURCE, notes: 'Found in your transactions (Bills)', created_by: user.id,
  }).select('id').single()
  if (error) return { error: error.message }

  const { error: mErr } = await supabase.from('insight_states').upsert(
    { key: input.key, scope: 'subscription', state: 'tracked', ref_id: row.id, done_month: null, snooze_until: null, created_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (mErr) {
    await supabase.from('planned_cashflows').delete().eq('id', row.id)
    return { error: tableMissing(mErr.message) ? NO_TABLE : mErr.message }
  }
  revalidate()
  return {}
}

/** "Not a subscription": hide a false positive (reversible with restoreSubscription). */
export async function dismissSubscription(key: string): Promise<Result> {
  if (!KEY_OK(key)) return { error: 'Unknown subscription' }
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase.from('insight_states').upsert(
    { key, scope: 'subscription', state: 'dismissed', ref_id: null, done_month: null, snooze_until: null, created_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (error) return { error: tableMissing(error.message) ? NO_TABLE : error.message }
  revalidate()
  return {}
}

/**
 * Undo a dismiss, or stop tracking. Stopping tracking cancels the planned item
 * (kept for history, not deleted) if it's still the one we created.
 */
export async function restoreSubscription(key: string): Promise<Result> {
  if (!KEY_OK(key)) return { error: 'Unknown subscription' }
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  const { data: s } = await supabase.from('insight_states').select('state, ref_id').eq('key', key).maybeSingle()
  if (s?.state === 'tracked' && s.ref_id) {
    await supabase.from('planned_cashflows').update({ status: 'cancelled' }).eq('id', s.ref_id).eq('source_table', DETECTED_SUBSCRIPTION_SOURCE)
  }
  const { error } = await supabase.from('insight_states').delete().eq('key', key).eq('scope', 'subscription')
  if (error) return { error: tableMissing(error.message) ? NO_TABLE : error.message }
  revalidate()
  return {}
}

// ── Budgets: confirm suggested targets ──────────────────────────────────────

export async function applySuggestedBudgets(items: { categoryId: string; monthlyCents: number }[]): Promise<Result> {
  if (!Array.isArray(items) || !items.length || items.length > 50) return { error: 'Nothing to save' }
  if (items.some(i => typeof i.categoryId !== 'string' || !Number.isSafeInteger(i.monthlyCents) || i.monthlyCents <= 0)) return { error: 'Check the amounts' }
  const { supabase, user } = await auth()
  if (!user) return { error: 'Not authenticated' }
  const effective = `${perthMonthKey()}-01`
  const { error } = await supabase.from('budgets').upsert(
    items.map(i => ({ category_id: i.categoryId, monthly_cents: i.monthlyCents, effective_from: effective, created_by: user.id })),
    { onConflict: 'category_id,effective_from' },
  )
  if (error) return { error: error.message }
  revalidate()
  return {}
}
