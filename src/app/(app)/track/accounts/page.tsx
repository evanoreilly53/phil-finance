import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { latestBalanceByAccount } from '@/lib/balances'
import { loadAccountFreshness } from '@/lib/freshnessData'
import TrackTabs from '@/components/TrackTabs'
import AccountsView, { type AccountRow } from './AccountsView'

export default async function AccountsPage() {
  const supabase = await createClient()
  const [{ data: accounts, error }, snapshots, freshness] = await Promise.all([
    supabase.from('accounts')
      .select('id, name, type, kind, owner, currency, is_liquid, institution, account_number_hint, import_profile, interest_rate_pct, offset_account_id, loan_original_cents, loan_start_date, loan_term_months, loan_repayment_cents, loan_repayment_freq, super_fund')
      .eq('is_active', true)
      .order('sort_order').order('name'),
    fetchAll((from, to) => supabase.from('account_snapshots')
      .select('date, account_id, aud_balance_cents')
      .order('date').order('id').range(from, to)),
    loadAccountFreshness(supabase),
  ])
  if (error) throw new Error(`Failed to load accounts: ${error.message}`)

  const latest = latestBalanceByAccount(snapshots)
  const fresh = new Map(freshness.map(f => [f.id, f]))
  const rows: AccountRow[] = (accounts ?? []).map(a => ({
    ...a,
    balance: latest.get(a.id) ?? null,
    freshness: fresh.get(a.id) ?? null,
  }))

  return (
    <div className="space-y-3">
      <TrackTabs />
      <AccountsView accounts={rows} />
    </div>
  )
}
