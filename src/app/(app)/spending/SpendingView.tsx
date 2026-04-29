'use client'

import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  type PieLabelRenderProps,
} from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtAUD, monthKey, monthLabel, perthMonthKey } from '@/lib/format'
import { monthlyExpenseMap } from '@/lib/chart'
import ChartTooltip from '@/components/ChartTooltip'
import { Card } from '@/components/Card'
import type { OwnerKey } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type TxCat = { id: string; name: string; colour: string | null; parent_id: string | null } | null

export type Transaction = {
  id: string
  date: string
  aud_amount_cents: number
  owner: OwnerKey
  is_large_one_off: boolean
  category_id: string | null
  categories: TxCat
}

export type Category = {
  id: string
  name: string
  parent_id: string | null
  owner: string
  colour: string | null
}

const FALLBACK_COLOURS = ['#818cf8','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa','#f472b6','#fb923c','#94a3b8']

// ── Aggregation ───────────────────────────────────────────────────────────────

type CategoryTotal = { name: string; colour: string; cents: number; pct: number }

function aggregateByParent(txs: Transaction[], categories: Category[]): CategoryTotal[] {
  const parentById = Object.fromEntries(categories.filter(c => !c.parent_id).map(c => [c.id, c]))
  const childToParent = Object.fromEntries(categories.filter(c => c.parent_id).map(c => [c.id, c.parent_id!]))

  const totals: Record<string, number> = {}
  for (const t of txs) {
    const catId = t.category_id
    if (!catId) continue
    const parentId = childToParent[catId] ?? catId
    totals[parentId] = (totals[parentId] ?? 0) + Math.abs(t.aud_amount_cents)
  }

  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0)
  return Object.entries(totals)
    .map(([id, cents], i) => ({
      name: parentById[id]?.name ?? 'Other',
      colour: parentById[id]?.colour ?? FALLBACK_COLOURS[i % FALLBACK_COLOURS.length],
      cents,
      pct: grandTotal > 0 ? (cents / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.cents - a.cents)
}

// Build last-N-months bar chart data using a single-pass expense map
function buildBarData(
  txs: Transaction[],
  months: string[],
  excludeOneOff: boolean,
  activeOwner: 'all' | OwnerKey,
) {
  // Single pass: filter once, then aggregate
  const filtered = txs.filter(t =>
    (!excludeOneOff || !t.is_large_one_off) &&
    (activeOwner === 'all' || t.owner === activeOwner),
  )
  const expMap = monthlyExpenseMap(filtered)

  return months.slice(0, 6).reverse().map(m => {
    const agg = expMap.get(m)
    return {
      label:  monthLabel(m, { month: 'short', year: '2-digit' }),
      joint:  Math.round((agg?.joint  ?? 0) / 100),
      rachel: Math.round((agg?.rachel ?? 0) / 100),
      evan:   Math.round((agg?.evan   ?? 0) / 100),
    }
  })
}

function makePieLabel(totals: CategoryTotal[]) {
  return function PieLabel(props: PieLabelRenderProps) {
    const cx = props.cx as number | undefined
    const cy = props.cy as number | undefined
    const midAngle = props.midAngle as number | undefined
    const innerRadius = props.innerRadius as number | undefined
    const outerRadius = props.outerRadius as number | undefined
    const index = props.index as number | undefined
    if (cx == null || cy == null || midAngle == null || innerRadius == null || outerRadius == null || index == null) return null
    const pct = totals[index]?.pct ?? 0
    if (pct < 5) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600}>
        {pct.toFixed(0)}%
      </text>
    )
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  transactions: Transaction[]
  categories: Category[]
}

export default function SpendingView({ transactions, categories }: Props) {
  const allMonths = useMemo(() => {
    const keys = [...new Set(transactions.map(t => monthKey(t.date)))].sort().reverse()
    return keys
  }, [transactions])

  const [monthIdx, setMonthIdx]         = useState(0)
  const [excludeOneOff, setExcludeOneOff] = useState(false)
  const [activeOwner, setActiveOwner]   = useState<'all' | 'joint' | 'rachel' | 'evan'>('all')

  const currentMonth    = allMonths[monthIdx] ?? ''
  const prevMonth       = allMonths[monthIdx + 1] ?? null
  const isPartialMonth  = currentMonth === perthMonthKey()

  // Transactions for selected month
  const monthTxs = useMemo(() => {
    let txs = transactions.filter(t => monthKey(t.date) === currentMonth)
    if (excludeOneOff) txs = txs.filter(t => !t.is_large_one_off)
    if (activeOwner !== 'all') txs = txs.filter(t => t.owner === activeOwner)
    return txs
  }, [transactions, currentMonth, excludeOneOff, activeOwner])

  const prevMonthTxs = useMemo(() => {
    if (!prevMonth) return []
    let txs = transactions.filter(t => monthKey(t.date) === prevMonth)
    if (excludeOneOff) txs = txs.filter(t => !t.is_large_one_off)
    if (activeOwner !== 'all') txs = txs.filter(t => t.owner === activeOwner)
    return txs
  }, [transactions, prevMonth, excludeOneOff, activeOwner])

  const totalCents = monthTxs.reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
  const prevTotalCents = prevMonthTxs.reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
  const monthChange = prevTotalCents > 0 ? ((totalCents - prevTotalCents) / prevTotalCents) * 100 : null

  const categoryTotals = useMemo(() => aggregateByParent(monthTxs, categories), [monthTxs, categories])
  const barData = useMemo(() => buildBarData(transactions, allMonths, excludeOneOff, activeOwner), [transactions, allMonths, excludeOneOff, activeOwner])

  const prevCategoryTotals = useMemo(
    () => aggregateByParent(prevMonthTxs, categories),
    [prevMonthTxs, categories],
  )

  const momChanges = useMemo(() => {
    if (!prevMonth || prevCategoryTotals.length === 0) return { increases: [], decreases: [] }
    const prevMap = new Map(prevCategoryTotals.map(c => [c.name, c.cents]))
    const currMap = new Map(categoryTotals.map(c => [c.name, c.cents]))

    // All category names from both months
    const allNames = new Set([...prevMap.keys(), ...currMap.keys()])
    const changes: { name: string; delta: number; pct: number | null }[] = []

    for (const name of allNames) {
      const curr = currMap.get(name) ?? 0
      const prev = prevMap.get(name) ?? 0
      const delta = curr - prev
      const pct   = prev > 0 ? (delta / prev) * 100 : null
      changes.push({ name, delta, pct })
    }

    const increases = changes.filter(c => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
    const decreases = changes.filter(c => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3)
    return { increases, decreases }
  }, [categoryTotals, prevCategoryTotals, prevMonth])

  // Personal spending split (always all months for Rachel/Evan widget)
  const rachelMonth = useMemo(() =>
    transactions.filter(t => monthKey(t.date) === currentMonth && t.owner === 'rachel')
      .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0),
    [transactions, currentMonth]
  )
  const evanMonth = useMemo(() =>
    transactions.filter(t => monthKey(t.date) === currentMonth && t.owner === 'evan')
      .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0),
    [transactions, currentMonth]
  )

  const pieData = categoryTotals.map(c => ({ name: c.name, value: Math.round(c.cents / 100) }))

  if (allMonths.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-500 text-sm">No spending data yet</Card>
    )
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Month nav */}
      <Card padded={false} className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setMonthIdx(i => Math.min(i + 1, allMonths.length - 1))}
          disabled={monthIdx >= allMonths.length - 1}
          aria-label="Previous month"
          className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors p-1"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <p className="text-white font-semibold">{monthLabel(currentMonth, { month: 'short', year: 'numeric' })}</p>
        <button
          onClick={() => setMonthIdx(i => Math.max(i - 1, 0))}
          disabled={monthIdx <= 0}
          aria-label="Next month"
          className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors p-1"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </Card>

      {/* Controls row */}
      <div className="flex gap-2">
        {/* Owner tabs */}
        <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-xs flex-1">
          {(['all', 'joint', 'rachel', 'evan'] as const).map(o => (
            <button
              key={o}
              onClick={() => setActiveOwner(o)}
              className={`flex-1 px-2 py-2 font-medium transition-colors capitalize ${activeOwner === o ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {o}
            </button>
          ))}
        </div>
        {/* One-off toggle */}
        <button
          onClick={() => setExcludeOneOff(v => !v)}
          className={`px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${excludeOneOff ? 'bg-orange-600/20 border-orange-600/40 text-orange-300' : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white'}`}
        >
          {excludeOneOff ? 'one-offs off' : 'incl. one-offs'}
        </button>
      </div>

      {/* Total card */}
      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Spent</p>
        <p className="text-3xl font-bold text-white">{fmtAUD(totalCents)}</p>
        {isPartialMonth
          ? <p className="text-xs text-gray-500 mt-1">month in progress</p>
          : monthChange !== null && (
              <p className={`text-sm mt-1 ${monthChange > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {monthChange > 0 ? '+' : ''}{monthChange.toFixed(1)}% vs {monthLabel(prevMonth!, { month: 'short', year: 'numeric' })}
              </p>
            )
        }
        <p className="text-xs text-gray-600 mt-1">{monthTxs.length} transactions</p>
      </Card>

      {/* Donut chart */}
      {categoryTotals.length > 0 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white mb-3">By Category</p>
          <p className="sr-only">
            Spending by category donut chart.
            {categoryTotals.slice(0, 3).map(c => ` ${c.name}: ${fmtAUD(c.cents)} (${c.pct.toFixed(0)}%)`).join(',')}
            {categoryTotals.length > 3 && ` and ${categoryTotals.length - 3} more.`}
          </p>
          <div className="flex gap-3 items-start">
            <div className="w-40 h-40 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={68}
                    dataKey="value"
                    labelLine={false}
                    label={makePieLabel(categoryTotals)}
                  >
                    {categoryTotals.map((c, i) => <Cell key={i} fill={c.colour} />)}
                  </Pie>
                  <ReTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0]
                      return (
                        <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs shadow-xl">
                          <p className="text-white font-medium">{d.name}</p>
                          <p className="text-gray-300">${(d.value as number).toLocaleString('en-AU')}</p>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex-1 space-y-1.5 overflow-hidden">
              {categoryTotals.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.colour }} />
                    <span className="text-xs text-gray-300 truncate">{c.name}</span>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{fmtAUD(c.cents)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Month-over-month bar chart */}
      {barData.length > 1 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white mb-3">Last {barData.length} Months</p>
          <p className="sr-only">
            Monthly spending bar chart.
            {barData.map(d => ` ${d.label}: $${(d.joint + d.rachel + d.evan).toLocaleString('en-AU')}`).join(',')}
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v/1000)+'k' : v)} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="joint"  name="Joint"  fill="#818cf8" radius={[2,2,0,0]} stackId="a" />
              <Bar dataKey="rachel" name="Rachel" fill="#f472b6" radius={[2,2,0,0]} stackId="a" />
              <Bar dataKey="evan"   name="Evan"   fill="#60a5fa" radius={[2,2,0,0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* vs Last Month */}
      {prevMonth && (momChanges.increases.length > 0 || momChanges.decreases.length > 0) && (
        <Card>
          <p className="text-sm font-semibold text-white mb-3">vs Last Month</p>
          {momChanges.increases.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Biggest increases</p>
              <div className="space-y-1.5">
                {momChanges.increases.map((c, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-red-400 text-xs">↑</span>
                      <span className="text-sm text-gray-300 truncate">{c.name}</span>
                    </div>
                    <span className="text-xs text-red-400 tabular-nums flex-shrink-0 ml-2">
                      +{fmtAUD(c.delta)}{c.pct !== null ? ` (+${c.pct.toFixed(0)}%)` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {momChanges.decreases.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Biggest decreases</p>
              <div className="space-y-1.5">
                {momChanges.decreases.map((c, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-green-400 text-xs">↓</span>
                      <span className="text-sm text-gray-300 truncate">{c.name}</span>
                    </div>
                    <span className="text-xs text-green-400 tabular-nums flex-shrink-0 ml-2">
                      {fmtAUD(c.delta)}{c.pct !== null ? ` (${c.pct.toFixed(0)}%)` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Rachel vs Evan personal widget */}
      {(rachelMonth > 0 || evanMonth > 0) && (
        <Card>
          <p className="text-sm font-semibold text-white mb-3">Personal Spending</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-pink-500/10 border border-pink-500/20 rounded-xl p-3">
              <p className="text-xs text-pink-300 mb-1">Rachel</p>
              <p className="text-lg font-bold text-white">{fmtAUD(rachelMonth)}</p>
            </div>
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3">
              <p className="text-xs text-sky-300 mb-1">Evan</p>
              <p className="text-lg font-bold text-white">{fmtAUD(evanMonth)}</p>
            </div>
          </div>
          {rachelMonth > 0 && evanMonth > 0 && (
            <div className="mt-3">
              <div className="flex h-2 rounded-full overflow-hidden">
                <div
                  className="bg-pink-500 transition-all"
                  style={{ width: `${(rachelMonth / (rachelMonth + evanMonth)) * 100}%` }}
                />
                <div className="bg-sky-500 flex-1 transition-all" />
              </div>
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{((rachelMonth / (rachelMonth + evanMonth)) * 100).toFixed(0)}%</span>
                <span>{((evanMonth / (rachelMonth + evanMonth)) * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Category breakdown table */}
      {categoryTotals.length > 0 && (
        <Card padded={false}>
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm font-semibold text-white">Breakdown</p>
          </div>
          <div className="divide-y divide-gray-800">
            {categoryTotals.map((c, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.colour }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{c.name}</p>
                  <div className="mt-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ backgroundColor: c.colour, width: `${c.pct}%` }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-white tabular-nums">{fmtAUD(c.cents)}</p>
                  <p className="text-xs text-gray-500">{c.pct.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
