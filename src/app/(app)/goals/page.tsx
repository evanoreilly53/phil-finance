import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import GoalsView from './GoalsView'
import { buildMonthlyNW } from '@/lib/forecast'
import { currentNetWorthCents } from '@/lib/balances'

export default async function GoalsPage() {
  const supabase = await createClient()

  const [{ data: goals }, { data: outflows }, snapshots, { data: accounts }] = await Promise.all([
    supabase.from('goals').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('planned_outflows').select('*').neq('status', 'cancelled').order('due_date'),
    fetchAll((from, to) => supabase
      .from('account_snapshots')
      .select('account_id, aud_balance_cents, date')
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase.from('accounts').select('id').eq('is_active', true),
  ])

  // Same basis as the Net Worth page: active accounts, balances carried forward
  const accountIds = new Set((accounts ?? []).map(a => a.id))
  const currentNW  = currentNetWorthCents(snapshots, { accountIds })

  // Monthly NW series for on-track slope computation
  const monthlyNW = buildMonthlyNW(snapshots, { accountIds })

  const nowMs = new Date().getTime()

  return (
    <GoalsView
      goals={goals ?? []}
      outflows={outflows ?? []}
      currentNW={currentNW}
      monthlyNWDollars={monthlyNW.map(m => m.dollars)}
      monthlyNWData={monthlyNW.map(m => ({ date: `${m.mk}-01`, nw: m.dollars }))}
      nowMs={nowMs}
    />
  )
}
