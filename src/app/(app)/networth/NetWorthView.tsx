'use client'

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Plus, TrendingUp, TrendingDown, Zap } from 'lucide-react'
import SnapshotModal from './SnapshotModal'
import { fmtAUD, fmtCompact, fmtDate } from '@/lib/format'
import { Card } from '@/components/Card'
import ChartSkeleton from '@/components/ChartSkeleton'
import {
  linearMonthlyGain, projectNetWorth, monthsToTarget, detectMilestones,
} from '@/lib/forecast'

const NetWorthChart = dynamic(() => import('./NetWorthChart'), {
  ssr: false,
  loading: () => <ChartSkeleton height={240} />,
})

// ── Types ─────────────────────────────────────────────────────────────────────

export type Snapshot = {
  id: string
  date: string
  account_id: string
  aud_balance_cents: number
  balance_cents: number
  currency: string
  fx_rate: number | null
}

export type Account = {
  id: string
  name: string
  type: string
  currency: string
  owner: string
  is_liquid: boolean
}

export type Goal = {
  id: string
  name: string
  kind?: string | null
  target_cents: number
  current_cents: number
  target_date: string | null
}

// ── Account groupings (also used in NetWorthChart.tsx) ───────────────────────

const CHART_GROUPS = [
  { key: 'investments', label: 'Investments', colour: '#818cf8', types: ['investment'] },
  { key: 'super',       label: 'Super',       colour: '#34d399', types: ['super'] },
  { key: 'bank',        label: 'Bank',        colour: '#60a5fa', types: ['bank', 'savings'] },
] as const

// ── Build chart data ──────────────────────────────────────────────────────────

function buildChartData(snapshots: Snapshot[], accounts: Account[]) {
  const accountById = Object.fromEntries(accounts.map(a => [a.id, a]))

  // Group snapshots by date
  const byDate: Record<string, Record<string, number>> = {}
  for (const snap of snapshots) {
    if (!byDate[snap.date]) byDate[snap.date] = {}
    byDate[snap.date][snap.account_id] = snap.aud_balance_cents
  }

  const dates = Object.keys(byDate).sort()

  return dates.map(date => {
    const balances = byDate[date]
    let total = 0
    const point: Record<string, number | string> = { date, label: fmtDate(date, { month: 'short', year: '2-digit' }) }

    for (const group of CHART_GROUPS) {
      let groupTotal = 0
      for (const [accId, cents] of Object.entries(balances)) {
        const acc = accountById[accId]
        if (acc && (group.types as readonly string[]).includes(acc.type)) {
          groupTotal += cents
        }
      }
      point[group.key] = Math.round(groupTotal / 100)
      total += groupTotal
    }
    point.total = Math.round(total / 100)
    return point
  })
}

// ── Latest balances ───────────────────────────────────────────────────────────

function getLatestBalances(snapshots: Snapshot[], accounts: Account[]) {
  const latest: Record<string, Snapshot> = {}
  for (const snap of snapshots) {
    if (!latest[snap.account_id] || snap.date > latest[snap.account_id].date) {
      latest[snap.account_id] = snap
    }
  }
  return accounts
    .filter(a => latest[a.id])
    .map(a => ({ account: a, snap: latest[a.id] }))
    .sort((a, b) => b.snap.aud_balance_cents - a.snap.aud_balance_cents)
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  snapshots: Snapshot[]
  accounts: Account[]
  goals: Goal[]
}

export default function NetWorthView({ snapshots, accounts, goals }: Props) {
  const [showUpdate, setShowUpdate] = useState(false)
  const [showTotal, setShowTotal]   = useState(true)

  const chartData = useMemo(() => buildChartData(snapshots, accounts), [snapshots, accounts])
  const latestBalances = useMemo(() => getLatestBalances(snapshots, accounts), [snapshots, accounts])

  const totalNW = latestBalances.reduce((s, { snap }) => s + snap.aud_balance_cents, 0)

  // Derive prevNW from raw snapshots (second-to-last date)
  const snapshotDates = useMemo(
    () => [...new Set(snapshots.map(s => s.date))].sort(),
    [snapshots],
  )
  const prevNW = snapshotDates.length >= 2
    ? snapshots
        .filter(s => s.date === snapshotDates[snapshotDates.length - 2])
        .reduce((sum, s) => sum + s.aud_balance_cents, 0)
    : null
  const nwChange = prevNW !== null ? totalNW - prevNW : null

  // Stable lookups by kind
  const nwGoal = goals.find(g => g.kind === 'net_worth_milestone')
  const nwGoalProgress = nwGoal ? Math.min(100, (totalNW / nwGoal.target_cents) * 100) : null
  const ultimateGoal   = goals.find(g => g.kind === 'net_worth_ultimate')
  const ultimateProgress = ultimateGoal ? Math.min(100, (totalNW / ultimateGoal.target_cents) * 100) : null

  // 12.1/12.2: projection + milestone detection
  const slope = useMemo(
    () => chartData.length >= 2 ? linearMonthlyGain(chartData.map(d => d.total as number)) : 0,
    [chartData],
  )

  const projectedData = useMemo(
    () => projectNetWorth(chartData, 12),
    [chartData],
  )

  // Merge: last historical point gets projected_total = total (so lines connect)
  const mergedData = useMemo(() => {
    if (!projectedData.length) return chartData
    const hist = chartData.slice(0, -1)
    const bridge = { ...chartData[chartData.length - 1], projected_total: chartData[chartData.length - 1].total }
    return [...hist, bridge, ...projectedData]
  }, [chartData, projectedData])

  const milestones = useMemo(() => detectMilestones(chartData), [chartData])

  const monthsToNWGoal = nwGoal && slope > 0
    ? monthsToTarget(totalNW / 100, nwGoal.target_cents / 100, slope)
    : null

  const lastUpdated = latestBalances.length
    ? latestBalances.reduce((latest, { snap }) => snap.date > latest ? snap.date : latest, '')
    : null

  return (
    <div className="space-y-4 pb-4">
      {/* Total NW card */}
      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Net Worth</p>
        <p className="text-3xl font-bold text-white">{fmtAUD(totalNW, { full: true })}</p>
        {nwChange !== null && (
          <div className={`flex items-center gap-1 mt-1 text-sm ${nwChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {nwChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{fmtAUD(nwChange, { signed: true, full: true })} since last snapshot</span>
          </div>
        )}
        {lastUpdated && (
          <p className="text-xs text-gray-400 mt-2">
            Updated {fmtDate(lastUpdated)}
          </p>
        )}
      </Card>

      {/* Goal progress */}
      {(nwGoalProgress !== null || ultimateProgress !== null) && (
        <Card className="space-y-4">
          <p className="text-sm font-semibold text-white">Goals</p>
          {nwGoal && nwGoalProgress !== null && (
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-gray-300">{nwGoal.name}</span>
                <span className="text-gray-400">{fmtCompact(totalNW)} / {fmtCompact(nwGoal.target_cents)}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${nwGoalProgress}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-gray-400">{nwGoalProgress.toFixed(1)}% · {fmtCompact(nwGoal.target_cents - totalNW)} to go</p>
                {monthsToNWGoal !== null && (
                  <span className="flex items-center gap-1 text-xs text-indigo-400">
                    <Zap size={10} />
                    {monthsToNWGoal}mo at current rate
                  </span>
                )}
              </div>
            </div>
          )}
          {ultimateGoal && ultimateProgress !== null && (
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-gray-300">{ultimateGoal.name}</span>
                <span className="text-gray-400">{fmtCompact(totalNW)} / {fmtCompact(ultimateGoal.target_cents)}</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${ultimateProgress}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">{ultimateProgress.toFixed(2)}%</p>
            </div>
          )}
        </Card>
      )}

      {/* Chart — lazy-loaded; includes 12-month dashed projection */}
      {chartData.length > 1 && (
        <Card padded={false} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-white">History &amp; Forecast</p>
            <button
              onClick={() => setShowTotal(t => !t)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showTotal ? 'Hide total' : 'Show total'}
            </button>
          </div>
          <NetWorthChart mergedData={mergedData} showTotal={showTotal} milestones={milestones} />

          {/* Milestone pills */}
          {milestones.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {milestones.map(m => (
                <span key={m.dollars} className="text-[10px] bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 px-2 py-0.5 rounded-full">
                  🏆 {m.label} reached {fmtDate(m.date, { month: 'short', year: 'numeric' })}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Account balances list */}
      <Card padded={false}>
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-semibold text-white">Account Balances</p>
        </div>
        <div className="divide-y divide-gray-800">
          {latestBalances.map(({ account: acc, snap }) => (
            <div key={acc.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm text-white">{acc.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {acc.type} · {acc.owner}
                  {acc.currency !== 'AUD' && ` · ${acc.currency}`}
                  {!acc.is_liquid && ' · illiquid'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-white tabular-nums">{fmtAUD(snap.aud_balance_cents, { full: true })}</p>
                <p className="text-xs text-gray-400">
                  {fmtDate(snap.date, { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </div>
          ))}
          {latestBalances.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">No snapshots yet</div>
          )}
        </div>
      </Card>

      {/* Update balances FAB */}
      <button
        onClick={() => setShowUpdate(true)}
        className="fixed bottom-24 right-4 w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center shadow-lg shadow-indigo-900/50 transition-colors z-20"
        aria-label="Update balances"
      >
        <Plus size={24} className="text-white" />
      </button>

      {showUpdate && (
        <SnapshotModal
          accounts={accounts}
          latestSnapshots={Object.fromEntries(latestBalances.map(({ account: a, snap }) => [a.id, snap]))}
          onClose={() => setShowUpdate(false)}
        />
      )}
    </div>
  )
}
