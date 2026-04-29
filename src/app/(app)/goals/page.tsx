import { createClient } from '@/lib/supabase/server'
import GoalsView from './GoalsView'
import { buildMonthlyNW } from '@/lib/forecast'

export default async function GoalsPage() {
  const supabase = await createClient()

  const [{ data: goals }, { data: outflows }, { data: snapshots }] = await Promise.all([
    supabase.from('goals').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('planned_outflows').select('*').neq('status', 'cancelled').order('due_date'),
    supabase
      .from('account_snapshots')
      .select('account_id, aud_balance_cents, date')
      .order('date', { ascending: true }),
  ])

  const latestByAccount: Record<string, number> = {}
  for (const s of (snapshots ?? []).slice().reverse()) {
    if (!latestByAccount[s.account_id]) latestByAccount[s.account_id] = s.aud_balance_cents
  }
  const currentNW = Object.values(latestByAccount).reduce((s, v) => s + v, 0)

  // Monthly NW series for on-track slope computation
  const monthlyNW = buildMonthlyNW(snapshots ?? [])

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
