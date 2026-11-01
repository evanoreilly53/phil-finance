import Link from 'next/link'
import type { Route } from 'next'
import { Inbox } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { loadAccountFreshness, type AccountFreshness } from '@/lib/freshnessData'
import { addDays, perthToday } from '@/lib/import/dates'
import FreshnessStrip from '@/components/FreshnessStrip'

/**
 * Home's data-health block: "N transactions need a look" + the freshness strip.
 * Never takes the page down: if it can't load (e.g. before migration 0007 has
 * been run) it renders nothing.
 */
export default async function DataHealth() {
  let freshness: AccountFreshness[] = []
  let reviewCount = 0
  try {
    const supabase = await createClient()
    const since = addDays(perthToday(), -90)
    const [f, { count, error }] = await Promise.all([
      loadAccountFreshness(supabase),
      supabase.from('transactions').select('id', { count: 'exact', head: true })
        .or(`needs_review.eq.true,and(category_id.is.null,is_transfer.eq.false,date.gte.${since})`),
    ])
    if (error) throw error
    freshness = f
    reviewCount = count ?? 0
  } catch {
    return null
  }

  return (
    <div className="space-y-3">
      {reviewCount > 0 && (
        <Link href={'/transactions/review' as Route}
          className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 text-sm text-amber-200 hover:bg-amber-500/15 transition-colors">
          <Inbox size={16} className="flex-shrink-0" />
          <span className="flex-1">{reviewCount} transaction{reviewCount === 1 ? '' : 's'} need a look</span>
          <span className="text-xs text-amber-300">Review →</span>
        </Link>
      )}
      <FreshnessStrip accounts={freshness} />
    </div>
  )
}
