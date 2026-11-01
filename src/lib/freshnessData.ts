import type { createClient } from '@/lib/supabase/server'
import type { AccountType } from '@/lib/supabase/database.types'
import { freshness, type FreshnessStatus } from '@/lib/freshness'
import { perthToday } from '@/lib/import/dates'

export type AccountFreshness = {
  id: string
  name: string
  type: AccountType
  institution: string | null
  importProfile: 'commbank' | 'generic' | null
  dataAsOf: string | null
  lastImportAt: string | null
  status: FreshnessStatus
  days: number | null
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Active accounts with how current their data is (from the account_freshness view). */
export async function loadAccountFreshness(supabase: Supabase): Promise<AccountFreshness[]> {
  const [{ data: accounts, error: aErr }, { data: fresh, error: fErr }] = await Promise.all([
    supabase.from('accounts').select('id, name, type, institution, import_profile').eq('is_active', true).order('sort_order').order('name'),
    supabase.from('account_freshness').select('account_id, data_as_of, last_import_at'),
  ])
  if (aErr || fErr) throw new Error(`Failed to load account freshness: ${(aErr ?? fErr)!.message}`)
  const byId = new Map((fresh ?? []).map(f => [f.account_id, f]))
  const today = perthToday()
  return (accounts ?? []).map(a => {
    const f = byId.get(a.id)
    const { status, days } = freshness(f?.data_as_of ?? null, today, a.type)
    return {
      id: a.id, name: a.name, type: a.type, institution: a.institution, importProfile: a.import_profile,
      dataAsOf: f?.data_as_of ?? null, lastImportAt: f?.last_import_at ?? null, status, days,
    }
  })
}
