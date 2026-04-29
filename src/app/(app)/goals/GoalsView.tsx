'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, ReferenceLine,
} from 'recharts'
import { Target, CheckCircle2, Clock, Plus, EllipsisVertical } from 'lucide-react'
import { fmtAUD, fmtCompact, fmtDate, daysUntilPerth, monthKey, monthLabel } from '@/lib/format'
import ChartTooltip from '@/components/ChartTooltip'
import { Card } from '@/components/Card'
import { OWNER_TEXT } from '@/lib/owners'
import { linearMonthlyGain, monthsToTarget } from '@/lib/forecast'
import { deleteGoal, markOutflowPaid, deletePlannedOutflow, cancelPlannedOutflow } from './actions'
import GoalModal from './GoalModal'
import OutflowModal from './OutflowModal'
import type { OwnerKey } from '@/lib/types'

export type Goal = {
  id: string
  name: string
  kind?: string | null
  owner: OwnerKey
  target_cents: number
  current_cents: number
  cadence: string | null
  target_date: string | null
  is_active: boolean | null
  sort_order: number | null
}

export type Outflow = {
  id: string
  description: string
  amount_cents: number
  due_date: string
  status: 'planned' | 'paid' | 'cancelled'
  category: string | null
  notes: string | null
}

const GOAL_COLOURS = ['bg-indigo-500', 'bg-pink-500', 'bg-sky-500', 'bg-purple-500', 'bg-green-500']

type MonthlyNWEntry = { date: string; nw: number }

type TrajectoryPoint = { date: string; required: number | null; actual: number | null }

function buildGoalTrajectory(
  monthlyData: MonthlyNWEntry[],
  goal: Goal,
): TrajectoryPoint[] {
  if (monthlyData.length < 2 || !goal.target_date) return []

  const startDate  = monthlyData[0].date
  const targetDate = goal.target_date
  const targetNW   = goal.target_cents / 100

  // Build a unified date range: historical dates + target date
  const allDates = [...monthlyData.map(m => m.date)]
  if (!allDates.includes(targetDate)) allDates.push(targetDate)
  allDates.sort()

  const startMs  = new Date(startDate).getTime()
  const targetMs = new Date(targetDate).getTime()
  const totalMs  = targetMs - startMs

  const nwByDate = new Map(monthlyData.map(m => [m.date, m.nw]))
  const startNW  = monthlyData[0].nw

  return allDates.map(date => {
    const dateMs = new Date(date).getTime()
    const ratio  = totalMs > 0 ? Math.max(0, Math.min(1, (dateMs - startMs) / totalMs)) : 0
    const required = Math.round(startNW + (targetNW - startNW) * ratio)
    const actual   = nwByDate.has(date) ? nwByDate.get(date)! : null
    return { date, required, actual }
  })
}

type Props = {
  goals: Goal[]
  outflows: Outflow[]
  currentNW: number
  monthlyNWDollars?: number[]
  monthlyNWData?: MonthlyNWEntry[]
  nowMs: number
}

export default function GoalsView({ goals, outflows, currentNW, monthlyNWDollars = [], monthlyNWData = [], nowMs }: Props) {
  const nwSlope = linearMonthlyGain(monthlyNWDollars)  // monthly gain in dollars
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date())

  const upcoming = outflows.filter(o => o.due_date >= today && o.status !== 'cancelled').slice(0, 10)
  const paid     = outflows.filter(o => o.status === 'paid')

  const totalOutflowRemaining = upcoming
    .filter(o => o.status === 'planned')
    .reduce((s, o) => s + o.amount_cents, 0)

  const paymentScheduleData = useMemo(() => {
    const planned = outflows.filter(o => o.status === 'planned')
    if (planned.length === 0) return []

    // Collect months from planned outflows, next 6 months
    const monthTotals = new Map<string, number>()
    for (const o of planned) {
      const mk = monthKey(o.due_date)
      monthTotals.set(mk, (monthTotals.get(mk) ?? 0) + o.amount_cents)
    }

    return [...monthTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 6)
      .map(([mk, cents]) => ({
        label: monthLabel(mk, { month: 'short', year: '2-digit' }),
        amount: Math.round(cents / 100),
      }))
  }, [outflows])

  const [showGoalModal, setShowGoalModal]       = useState(false)
  const [editingGoal,   setEditingGoal]         = useState<Goal | null>(null)
  const [showOutflowModal, setShowOutflowModal] = useState(false)
  const [editingOutflow, setEditingOutflow]     = useState<Outflow | null>(null)
  const [goalMenuId, setGoalMenuId]             = useState<string | null>(null)
  const [outflowMenuId, setOutflowMenuId]       = useState<string | null>(null)

  // Close menus on outside click
  useEffect(() => {
    if (!goalMenuId && !outflowMenuId) return
    function close() { setGoalMenuId(null); setOutflowMenuId(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [goalMenuId, outflowMenuId])

  async function handleDeleteGoal(id: string) {
    setGoalMenuId(null)
    await deleteGoal(id)
  }

  async function handleMarkPaid(id: string) {
    setOutflowMenuId(null)
    await markOutflowPaid(id)
  }

  async function handleDeleteOutflow(id: string) {
    setOutflowMenuId(null)
    await deletePlannedOutflow(id)
  }

  async function handleCancelOutflow(id: string) {
    setOutflowMenuId(null)
    await cancelPlannedOutflow(id)
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Goals */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Goals</p>
          <button onClick={() => setShowGoalModal(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
            <Plus size={12} /> Add
          </button>
        </div>

        {goals.map((goal, i) => {
          const isNWGoal = goal.kind === 'net_worth_milestone' || goal.kind === 'net_worth_ultimate'
          const current   = isNWGoal ? currentNW : goal.current_cents
          const pct       = goal.target_cents > 0 ? Math.min(100, (current / goal.target_cents) * 100) : 0
          const barColour = GOAL_COLOURS[i % GOAL_COLOURS.length]

          // 12.3 On-track signal for NW goals
          let onTrack: 'green' | 'amber' | 'red' | null = null
          let mthsRemain: number | null = null
          if (isNWGoal && nwSlope > 0 && goal.target_date) {
            const daysLeft = Math.ceil((new Date(goal.target_date).getTime() - nowMs) / 86_400_000)
            const moLeft   = Math.max(1, daysLeft / 30)
            const required = (goal.target_cents / 100 - currentNW / 100) / moLeft
            const ratio    = nwSlope / required
            onTrack = ratio >= 1.1 ? 'green' : ratio >= 0.75 ? 'amber' : 'red'
            mthsRemain = monthsToTarget(currentNW / 100, goal.target_cents / 100, nwSlope)
          }

          return (
            <div key={goal.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Target size={14} className="text-gray-500 flex-shrink-0" />
                    <p className="text-sm font-semibold text-white">{goal.name}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs capitalize ${OWNER_TEXT[goal.owner]}`}>{goal.owner}</span>
                    {goal.cadence && <span className="text-xs text-gray-500">· {goal.cadence}</span>}
                    {goal.target_date && <span className="text-xs text-gray-500">· by {fmtDate(goal.target_date)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {onTrack && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      onTrack === 'green' ? 'bg-green-500/20 text-green-300' :
                      onTrack === 'amber' ? 'bg-yellow-500/20 text-yellow-300' :
                                           'bg-red-500/20 text-red-300'
                    }`}>
                      {onTrack === 'green' ? '✓ on track' : onTrack === 'amber' ? '~ behind' : '✗ off track'}
                    </span>
                  )}
                  <p className="text-sm font-bold text-white">{pct.toFixed(pct < 1 ? 2 : 1)}%</p>
                  <div className="relative">
                    <button onClick={e => { e.stopPropagation(); setGoalMenuId(goalMenuId === goal.id ? null : goal.id) }}
                      aria-label="Goal actions" className="p-1 text-gray-600 hover:text-gray-300 transition-colors">
                      <EllipsisVertical size={14} />
                    </button>
                    {goalMenuId === goal.id && (
                      <div className="absolute right-0 top-7 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[110px]"
                        onClick={e => e.stopPropagation()}>
                        <button className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                          onClick={() => { setEditingGoal(goal); setGoalMenuId(null) }}>Edit</button>
                        <button className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                          onClick={() => handleDeleteGoal(goal.id)}>Remove</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="h-3 bg-gray-800 rounded-full overflow-hidden mb-2">
                <div className={`h-full ${barColour} rounded-full transition-all`} style={{ width: `${pct}%` }} />
              </div>

              <div className="flex justify-between text-xs text-gray-500">
                <span>{fmtCompact(current)}</span>
                <span>target {fmtCompact(goal.target_cents)}</span>
              </div>
              {goal.target_cents - current > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {fmtAUD(goal.target_cents - current)} to go
                  {goal.target_date && (() => {
                    const days = daysUntilPerth(goal.target_date)
                    if (days <= 0) return <span className="text-red-400"> · overdue</span>
                    const perMonth = Math.ceil((goal.target_cents - current) / (days / 30))
                    return <span> · ~{fmtCompact(perMonth)}/mo needed</span>
                  })()}
                  {mthsRemain !== null && (
                    <span className="text-indigo-400"> · ~{mthsRemain}mo at current rate</span>
                  )}
                </p>
              )}

              {/* Trajectory chart for NW goals */}
              {isNWGoal && (() => {
                const trajectory = buildGoalTrajectory(monthlyNWData, goal)
                if (trajectory.length < 2) return null
                const todayStr  = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date())
                const isOnTrack = onTrack === 'green'
                return (
                  <div className="mt-3">
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={trajectory} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 9, fill: '#6b7280' }}
                          tickFormatter={d => {
                            const dt = new Date(d + 'T00:00:00')
                            return dt.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
                          }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 9, fill: '#6b7280' }}
                          tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <ReferenceLine
                          x={todayStr}
                          stroke="#facc15"
                          strokeDasharray="4 4"
                          label={{ value: 'Today', position: 'insideTopRight', fontSize: 9, fill: '#facc15' }}
                        />
                        <Line
                          type="linear"
                          dataKey="required"
                          name="Required"
                          stroke="#4b5563"
                          strokeDasharray="4 4"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          name="Actual"
                          stroke={isOnTrack ? '#34d399' : '#f87171'}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )
              })()}
            </div>
          )
        })}

        {goals.length === 0 && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 text-center text-sm text-gray-500">
            No goals set
          </div>
        )}
      </div>

      {/* Planned outflows */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Upcoming Payments</p>
          <div className="flex items-center gap-3">
            {totalOutflowRemaining > 0 && (
              <p className="text-xs text-gray-500">{fmtAUD(totalOutflowRemaining)} total</p>
            )}
            <button onClick={() => setShowOutflowModal(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
              <Plus size={12} /> Add
            </button>
          </div>
        </div>

        {paymentScheduleData.length > 0 && (
          <Card padded={false} className="p-4">
            <p className="text-sm font-semibold text-white mb-3">Payment Schedule</p>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={paymentScheduleData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" name="Due" fill="#fbbf24" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {upcoming.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 text-center text-sm text-gray-500">
            No upcoming payments
          </div>
        ) : (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
            {upcoming.map(o => {
              const days  = daysUntilPerth(o.due_date)
              const isPast = days < 0
              const isSoon = days <= 30 && days >= 0
              return (
                <div key={o.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-shrink-0">
                    {o.status === 'paid'
                      ? <CheckCircle2 size={16} className="text-green-500" />
                      : <Clock size={16} className={isSoon ? 'text-yellow-400' : isPast ? 'text-red-400' : 'text-gray-600'} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{o.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{fmtDate(o.due_date)}</span>
                      {o.category && <span className="text-xs text-gray-500">· {o.category}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-medium tabular-nums ${o.status === 'paid' ? 'text-green-400 line-through' : 'text-white'}`}>
                      {fmtAUD(o.amount_cents)}
                    </p>
                    {o.status !== 'paid' && (
                      <p className={`text-xs mt-0.5 ${isPast ? 'text-red-400' : isSoon ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {isPast ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `in ${days}d`}
                      </p>
                    )}
                  </div>

                  {/* Mark paid + overflow */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {o.status === 'planned' && (
                      <button onClick={() => handleMarkPaid(o.id)}
                        className="text-xs text-green-400 hover:text-green-300 border border-green-500/30 rounded-lg px-2 py-1 transition-colors whitespace-nowrap"
                        aria-label={`Mark ${o.description} as paid`}>
                        Paid ✓
                      </button>
                    )}
                    <div className="relative">
                      <button onClick={e => { e.stopPropagation(); setOutflowMenuId(outflowMenuId === o.id ? null : o.id) }}
                        aria-label="Payment actions" className="p-1 text-gray-600 hover:text-gray-300 transition-colors">
                        <EllipsisVertical size={14} />
                      </button>
                      {outflowMenuId === o.id && (
                        <div className="absolute right-0 top-7 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[110px]"
                          onClick={e => e.stopPropagation()}>
                          <button className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                            onClick={() => { setEditingOutflow(o); setOutflowMenuId(null) }}>Edit</button>
                          <button className="w-full text-left px-4 py-2.5 text-sm text-yellow-400 hover:bg-gray-700 transition-colors"
                            onClick={() => handleCancelOutflow(o.id)}>Cancel</button>
                          <button className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                            onClick={() => handleDeleteOutflow(o.id)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {paid.length > 0 && (
          <p className="text-xs text-center text-gray-500">{paid.length} payment{paid.length !== 1 ? 's' : ''} already made</p>
        )}
      </div>

      {/* Modals */}
      {showGoalModal   && <GoalModal onClose={() => setShowGoalModal(false)} />}
      {editingGoal     && <GoalModal editing={editingGoal} onClose={() => setEditingGoal(null)} />}
      {showOutflowModal && <OutflowModal onClose={() => setShowOutflowModal(false)} />}
      {editingOutflow  && <OutflowModal editing={editingOutflow} onClose={() => setEditingOutflow(null)} />}
    </div>
  )
}
