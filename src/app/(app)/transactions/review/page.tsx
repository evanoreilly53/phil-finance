import { createClient } from '@/lib/supabase/server'
import { addDays, perthToday } from '@/lib/import/dates'
import ReviewQueue, { type ReviewTx, type ReviewOriginal } from './ReviewQueue'

const UNCATEGORISED_LOOKBACK_DAYS = 90
const LIMIT = 200

export default async function ReviewPage() {
  const supabase = await createClient()
  const since = addDays(perthToday(), -UNCATEGORISED_LOOKBACK_DAYS)

  const [{ data: rows, error }, { data: categories }, { data: accounts }] = await Promise.all([
    supabase.from('transactions')
      .select('id, date, description, amount_cents, aud_amount_cents, currency, owner, account_id, category_id, is_transfer, transfer_account_id, transfer_peer_id, duplicate_of_id, review_flags, accounts!transactions_account_id_fkey(name)')
      // flagged rows of any age, plus recent rows that still need a category
      .or(`needs_review.eq.true,and(category_id.is.null,is_transfer.eq.false,date.gte.${since})`)
      .order('date', { ascending: false })
      .order('id')
      .limit(LIMIT),
    supabase.from('categories').select('id, name, parent_id, kind').order('sort_order'),
    supabase.from('accounts').select('id, name, kind').eq('is_active', true).order('sort_order').order('name'),
  ])
  if (error) throw new Error(`Failed to load the review queue: ${error.message}`)

  const list = (rows ?? []) as unknown as ReviewTx[]
  const dupIds = [...new Set(list.map(r => r.duplicate_of_id).filter((x): x is string => !!x))]
  const { data: originals } = dupIds.length
    ? await supabase.from('transactions').select('id, date, description, aud_amount_cents').in('id', dupIds)
    : { data: [] as ReviewOriginal[] }

  return (
    <ReviewQueue
      rows={list}
      originals={originals ?? []}
      categories={categories ?? []}
      accounts={accounts ?? []}
      truncated={list.length === LIMIT}
      lookbackDays={UNCATEGORISED_LOOKBACK_DAYS}
    />
  )
}
