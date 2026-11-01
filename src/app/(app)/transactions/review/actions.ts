'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { suggestRulePattern } from '@/lib/review'
import type { ReviewFlag } from '@/lib/supabase/database.types'

type Result = { error?: string; rule?: string | null }

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function without(flags: readonly ReviewFlag[] | null | undefined, f: ReviewFlag): ReviewFlag[] {
  return (flags ?? []).filter(x => x !== f)
}

function done() {
  revalidatePath('/transactions/review')
  revalidatePath('/transactions')
  revalidatePath('/dashboard')
}

/** Set a category; optionally learn a rule so the next import does it automatically. */
export async function setReviewCategory(id: string, categoryId: string, learn: boolean): Promise<Result> {
  const { supabase, user } = await ctx()
  if (!user) return { error: 'Not authenticated' }
  const { data: row, error } = await supabase.from('transactions')
    .update({ category_id: categoryId }).eq('id', id).select('description, owner').maybeSingle()
  if (error) return { error: error.message }
  if (!row) return { error: 'Transaction not found' }

  let rule: string | null = null
  if (learn) {
    rule = suggestRulePattern(row.description)
    if (rule) {
      const { data: existing } = await supabase.from('categorisation_rules').select('id').eq('pattern', rule).limit(1)
      if (!existing?.length) {
        const { error: rErr } = await supabase.from('categorisation_rules')
          .insert({ pattern: rule, category_id: categoryId, owner: null, priority: 0, is_active: true, created_by: user.id })
        if (rErr) return { error: `Saved, but the rule failed: ${rErr.message}`, rule: null }
      }
    }
  }
  done()
  return { rule }
}

/** Confirm a transfer to one of our accounts; links and confirms the other leg if we hold it. */
export async function confirmTransfer(id: string, accountId: string | null): Promise<Result> {
  const { supabase, user } = await ctx()
  if (!user) return { error: 'Not authenticated' }
  const { data: row } = await supabase.from('transactions')
    .select('account_id, review_flags, transfer_peer_id, transfer_account_id').eq('id', id).maybeSingle()
  if (!row) return { error: 'Transaction not found' }

  const peerId = row.transfer_peer_id
  const target = accountId ?? row.transfer_account_id
  const { error } = await supabase.from('transactions').update({
    is_transfer: true,
    transfer_account_id: target,
    // a peer in a different account than the one picked isn't this transfer's other leg
    transfer_peer_id: peerId && (!accountId || accountId === row.transfer_account_id) ? peerId : null,
    review_flags: without(row.review_flags, 'suspected_transfer'),
  }).eq('id', id)
  if (error) return { error: error.message }

  if (peerId && (!accountId || accountId === row.transfer_account_id)) {
    const { data: peer } = await supabase.from('transactions').select('review_flags').eq('id', peerId).maybeSingle()
    if (peer) {
      await supabase.from('transactions').update({
        is_transfer: true, transfer_peer_id: id, transfer_account_id: row.account_id,
        review_flags: without(peer.review_flags, 'suspected_transfer'),
      }).eq('id', peerId)
    }
  }
  done()
  return {}
}

/** Not a transfer: drop the flag and the suggested pairing (on both sides). */
export async function rejectTransfer(id: string): Promise<Result> {
  const { supabase, user } = await ctx()
  if (!user) return { error: 'Not authenticated' }
  const { data: row } = await supabase.from('transactions')
    .select('review_flags, transfer_peer_id').eq('id', id).maybeSingle()
  if (!row) return { error: 'Transaction not found' }

  const { error } = await supabase.from('transactions').update({
    is_transfer: false, transfer_account_id: null, transfer_peer_id: null,
    review_flags: without(row.review_flags, 'suspected_transfer'),
  }).eq('id', id)
  if (error) return { error: error.message }

  if (row.transfer_peer_id) {
    const { data: peer } = await supabase.from('transactions')
      .select('review_flags, transfer_peer_id, is_transfer').eq('id', row.transfer_peer_id).maybeSingle()
    if (peer && peer.transfer_peer_id === id && !peer.is_transfer) {
      await supabase.from('transactions').update({
        transfer_peer_id: null, transfer_account_id: null,
        review_flags: without(peer.review_flags, 'suspected_transfer'),
      }).eq('id', row.transfer_peer_id)
    }
  }
  done()
  return {}
}

/** Not a duplicate: keep it and clear the flag. */
export async function keepNotDuplicate(id: string): Promise<Result> {
  const { supabase, user } = await ctx()
  if (!user) return { error: 'Not authenticated' }
  const { data: row } = await supabase.from('transactions').select('review_flags').eq('id', id).maybeSingle()
  if (!row) return { error: 'Transaction not found' }
  const { error } = await supabase.from('transactions')
    .update({ duplicate_of_id: null, review_flags: without(row.review_flags, 'suspected_duplicate') }).eq('id', id)
  if (error) return { error: error.message }
  done()
  return {}
}

/** It IS a duplicate: remove the newly imported copy (the audit log keeps a record). */
export async function removeDuplicate(id: string): Promise<Result> {
  const { supabase, user } = await ctx()
  if (!user) return { error: 'Not authenticated' }
  const { data, error } = await supabase.from('transactions').delete().eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Nothing deleted' }
  done()
  return {}
}
