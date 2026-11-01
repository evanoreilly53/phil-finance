'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { planImport, type NormalisedRow, type ExistingRow, type ImportSummary } from '@/lib/import/pipeline'
import { addDays } from '@/lib/import/dates'
import type { ImportProfile, ReviewFlag } from '@/lib/supabase/database.types'

export type ImportRow = NormalisedRow

export type ImportRequest = {
  profile: ImportProfile
  fileName: string | null
  /** Set when the whole file belongs to one account (always for CommBank). */
  accountId: string | null
  rows: ImportRow[]
  /** Bank running balance at the end of the file, if it had one. */
  closing: { date: string; balance_cents: number } | null
  updateBalance: boolean
}

export type RowVerdict = { status: 'import' | 'skip_duplicate'; is_transfer: boolean; flags: ReviewFlag[]; category_id: string | null }
export type PreviewResult = { summary?: ImportSummary; verdicts?: RowVerdict[]; error?: string }
export type CommitResult = { imported: number; summary?: ImportSummary; snapshot?: boolean; error?: string }

const MAX_ROWS = 5000
const OWNERS = new Set(['joint', 'rachel', 'evan'])

function validate(rows: ImportRow[]): string | null {
  if (rows.length > MAX_ROWS) return `Too many rows (${rows.length}). Import at most ${MAX_ROWS} at a time.`
  // Never store a foreign amount as AUD; never hand Postgres an ambiguous date.
  const bad = rows.find(r =>
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
    !r.account_id || !OWNERS.has(r.owner) || !r.description ||
    !Number.isSafeInteger(r.amount_cents) || !Number.isSafeInteger(r.aud_amount_cents) ||
    (r.currency !== 'AUD' && !(typeof r.fx_rate === 'number' && r.fx_rate > 0)),
  )
  return bad ? `Invalid row "${bad.description}": needs an ISO date, an account and, for non-AUD, an FX rate` : null
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Everything the planner needs from the database, scoped to the file's dates ± a few days. */
async function loadContext(supabase: Supabase, rows: ImportRow[]) {
  const dates = rows.map(r => r.date).sort()
  const from = addDays(dates[0], -5)
  const to   = addDays(dates[dates.length - 1], 5)

  const [{ data: accounts, error: aErr }, { data: rules }, existing] = await Promise.all([
    supabase.from('accounts').select('id, account_number_hint, currency, owner'),
    supabase.from('categorisation_rules').select('pattern, category_id, owner, priority, is_active').eq('is_active', true),
    fetchAll((f, t) => supabase.from('transactions')
      .select('id, account_id, date, amount_cents, aud_amount_cents, description, external_id, is_transfer, transfer_peer_id, review_flags')
      .gte('date', from).lte('date', to)
      .order('date').order('id')
      .range(f, t)),
  ])
  if (aErr) throw new Error(aErr.message)
  const known = new Set((accounts ?? []).map(a => a.id))
  const unknown = rows.find(r => !known.has(r.account_id))
  if (unknown) throw new Error(`Unknown account for "${unknown.description}"`)
  return { accounts: accounts ?? [], rules: rules ?? [], existing }
}

function plan(rows: ImportRow[], ctx: Awaited<ReturnType<typeof loadContext>>) {
  return planImport({
    rows,
    existing: ctx.existing as ExistingRow[],
    accounts: ctx.accounts,
    rules: ctx.rules,
    newId: () => crypto.randomUUID(),
  })
}

export async function previewImport(rows: ImportRow[]): Promise<PreviewResult> {
  if (rows.length === 0) return { error: 'No rows to import' }
  const invalid = validate(rows)
  if (invalid) return { error: invalid }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  try {
    const p = plan(rows, await loadContext(supabase, rows))
    return {
      summary: p.summary,
      verdicts: p.rows.map(r => ({ status: r.status, is_transfer: r.is_transfer, flags: r.review_flags, category_id: r.category_id })),
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Preview failed' }
  }
}

export async function commitImport(req: ImportRequest): Promise<CommitResult> {
  const rows = req.rows
  if (rows.length === 0) return { imported: 0, error: 'No rows to import' }
  const invalid = validate(rows)
  if (invalid) return { imported: 0, error: invalid }
  if (req.accountId && rows.some(r => r.account_id !== req.accountId)) return { imported: 0, error: 'Rows do not match the chosen account' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { imported: 0, error: 'Not authenticated' }

  let ctx: Awaited<ReturnType<typeof loadContext>>
  try { ctx = await loadContext(supabase, rows) } catch (e) {
    return { imported: 0, error: e instanceof Error ? e.message : 'Could not load existing data' }
  }
  // Re-plan on the server: never trust the client's dedupe/transfer verdicts
  const p = plan(rows, ctx)
  const toInsert = p.rows.filter(r => r.status === 'import')

  // 1. The batch row (also our "data fresh to" marker, even if every row was a duplicate)
  const { data: batch, error: bErr } = await supabase.from('import_batches').insert({
    account_id: req.accountId,
    profile: req.profile,
    file_name: req.fileName?.slice(0, 200) ?? null,
    row_count: p.summary.total,
    imported_count: toInsert.length,
    duplicate_count: p.summary.duplicates,
    flagged_count: toInsert.filter(r => r.review_flags.length > 0 || (!r.is_transfer && !r.category_id)).length,
    date_from: p.summary.dateFrom,
    date_to: p.summary.dateTo,
    closing_balance_cents: req.closing?.balance_cents ?? null,
    created_by: user.id,
  }).select('id').single()
  if (bErr || !batch) return { imported: 0, error: bErr?.message ?? 'Could not start the import' }

  // 2. All rows in ONE insert statement, so it's all-or-nothing. ignoreDuplicates
  //    covers a race with another import of the same file.
  if (toInsert.length > 0) {
    const { error } = await supabase.from('transactions').upsert(
      toInsert.map(r => ({
        id: r.id,
        date: r.date,
        description: r.description,
        amount_cents: r.amount_cents,
        currency: r.currency,
        aud_amount_cents: r.aud_amount_cents,
        fx_rate: r.fx_rate,
        account_id: r.account_id,
        category_id: r.category_id,
        owner: r.owner,
        is_large_one_off: false,
        notes: r.notes,
        created_by: user.id,
        external_id: r.external_id,
        import_batch_id: batch.id,
        balance_after_cents: r.balance_cents,
        is_transfer: r.is_transfer,
        transfer_account_id: r.transfer_account_id,
        transfer_peer_id: r.transfer_peer_id,
        duplicate_of_id: r.duplicate_of_id,
        review_flags: r.review_flags,
      })),
      { onConflict: 'account_id,external_id', ignoreDuplicates: true },
    )
    if (error) {
      await supabase.from('import_batches').delete().eq('id', batch.id)
      return { imported: 0, error: error.message }
    }
  }

  // 3. Link the stored other legs of transfers (best effort: a failure here
  //    only means the pairing shows up in the review queue instead).
  const flagsById = new Map(ctx.existing.map(e => [e.id, e.review_flags as ReviewFlag[]]))
  for (const u of p.peerUpdates) {
    const flags = flagsById.get(u.id) ?? []
    await supabase.from('transactions').update({
      transfer_peer_id: u.transfer_peer_id,
      transfer_account_id: u.transfer_account_id,
      ...(u.is_transfer ? { is_transfer: true } : {}),
      ...(u.flag && !flags.includes('suspected_transfer') ? { review_flags: [...flags, 'suspected_transfer' as const] } : {}),
    }).eq('id', u.id)
  }

  // 4. Closing balance → snapshot (never overwrites one already entered that day)
  let snapshot = false
  if (req.updateBalance && req.closing && req.accountId) {
    const acc = ctx.accounts.find(a => a.id === req.accountId)
    if (acc && acc.currency === 'AUD') {
      const { error } = await supabase.from('account_snapshots').upsert({
        date: req.closing.date,
        account_id: req.accountId,
        balance_cents: req.closing.balance_cents,
        currency: 'AUD',
        aud_balance_cents: req.closing.balance_cents,
        fx_rate: 1,
        notes: 'From CSV import',
        created_by: user.id,
      }, { onConflict: 'date,account_id', ignoreDuplicates: true })
      snapshot = !error
    }
  }

  revalidatePath('/transactions')
  revalidatePath('/dashboard')
  revalidatePath('/track/accounts')
  return { imported: toInsert.length, summary: p.summary, snapshot }
}
