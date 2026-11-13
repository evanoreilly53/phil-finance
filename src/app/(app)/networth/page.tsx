import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import NetWorthView, { type ProjectedPoint } from './NetWorthView'
import TrackTabs from '@/components/TrackTabs'
import { loadPlan } from '@/lib/projection/load'
import { runProjection } from '@/lib/projection/engine'
import { hitMonth } from '@/lib/projection/goals'
import { monthLabel } from '@/lib/format'

export default async function NetWorthPage() {
  const supabase = await createClient()

  const [snapshots, { data: accounts }, { data: goals }, plan] = await Promise.all([
    fetchAll((from, to) => supabase
      .from('account_snapshots')
      .select('id, date, account_id, aud_balance_cents, balance_cents, currency, fx_rate')
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    supabase
      .from('accounts')
      .select('id, name, type, currency, owner, is_liquid')
      .eq('is_active', true),
    supabase
      .from('goals')
      .select('id, name, kind, target_cents, current_cents, target_date')
      .eq('is_active', true)
      .order('sort_order'),
    loadPlan(supabase, { months: 12 }),
  ])

  // Next 12 months from the projection engine (replaces the old straight-line trend)
  const projection = runProjection(plan.input)
  const projected: ProjectedPoint[] = projection.months.map(m => ({
    date: `${m.month}-15`,
    label: monthLabel(m.month, { month: 'short', year: '2-digit' }),
    projected_total: Math.round(m.netWorthCents / 100),
  }))
  const nwGoal = (goals ?? []).find(g => g.kind === 'net_worth_milestone')
  const longRun = nwGoal ? runProjection({ ...plan.input, months: 360 }) : null
  const nwGoalHit = nwGoal && longRun ? hitMonth(longRun, 'netWorthCents', nwGoal.target_cents) : null

  return (
    <div className="space-y-3">
    <TrackTabs />
    <NetWorthView
      snapshots={snapshots}
      accounts={accounts ?? []}
      goals={goals ?? []}
      projected={projected}
      nwGoalHit={nwGoalHit}
    />
    </div>
  )
}
