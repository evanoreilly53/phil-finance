'use client'

import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, LineChart, Line,
} from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtAUD, monthKey, monthLabel, perthMonthKey } from '@/lib/format'
import ChartTooltip from '@/components/ChartTooltip'
import { Card } from '@/components/Card'
import type { OwnerKey } from '@/lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const INVEST_COLOURS = ['#fb923c', '#60a5fa', '#34d399', '#a78bfa', '#f472b6']
const INVEST_TEXT    = ['text-orange-300', 'text-blue-300', 'text-emerald-300', 'text-violet-300', 'text-pink-300']
const INVEST_BORDER  = ['border-orange-500/25', 'border-blue-500/25', 'border-emerald-500/25', 'border-violet-500/25', 'border-pink-500/25']

// ── Types ─────────────────────────────────────────────────────────────────────

type TxCat = { id: string; name: string; parent_id: string | null } | null

type Transaction = {
  id: string
  date: string
  aud_amount_cents: number
  owner: OwnerKey
  category_id: string | null
  categories: TxCat
}

type Snapshot = {
  date: string
  account_id: string
  aud_balance_cents: number
}

type Account = {
  id: string
  name: string
  type: string
}

type Category = {
  id: string
  name: string
  parent_id: string | null
}

export type { Transaction }

type Props = {
  transactions: Transaction[]
  snapshots: Snapshot[]
  accounts: Account[]
  categories: Category[]
  monthlyIncomeCents: number
  personalBudgetCents: number
}

function resolveParentName(catId: string | null, joined: TxCat, allCats: Category[]): string {
  if (!catId || !joined) return 'Uncategorised'
  if (!joined.parent_id) return joined.name
  const parent = allCats.find(c => c.id === joined.parent_id)
  return parent?.name ?? joined.name
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InsightsView({ transactions, snapshots, accounts, categories, monthlyIncomeCents: MONTHLY_INCOME_CENTS, personalBudgetCents: PERSONAL_BUDGET_CENTS }: Props) {
  const allMonths = useMemo(() => {
    const keys = [...new Set(transactions.map(t => monthKey(t.date)))].sort().reverse()
    return keys
  }, [transactions])

  const [monthIdx, setMonthIdx] = useState(0)
  const currentMonth = allMonths[monthIdx] ?? ''

  // ── Savings Rate ──────────────────────────────────────────────────────────────

  const savingsRateData = useMemo(() => {
    return allMonths.slice(0, 4).reverse().map(m => {
      const spending = transactions
        .filter(t => monthKey(t.date) === m)
        .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
      const savings = Math.max(0, MONTHLY_INCOME_CENTS - spending)
      const rate = Math.round((savings / MONTHLY_INCOME_CENTS) * 100)
      return { label: monthLabel(m, { month: 'short', year: 'numeric' }), rate, spending: Math.round(spending / 100) }
    })
  }, [transactions, allMonths, MONTHLY_INCOME_CENTS])

  const currentSavings = useMemo(() => {
    const spending = transactions
      .filter(t => monthKey(t.date) === currentMonth)
      .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
    const savings = Math.max(0, MONTHLY_INCOME_CENTS - spending)
    return {
      spending,
      savings,
      rate: Math.round((savings / MONTHLY_INCOME_CENTS) * 100),
    }
  }, [transactions, currentMonth, MONTHLY_INCOME_CENTS])

  const prevSavingsRate = savingsRateData.length >= 2
    ? savingsRateData[savingsRateData.length - 2]?.rate ?? null
    : null

  // ── Rent-to-Income ────────────────────────────────────────────────────────────

  const rentCents = useMemo(() => {
    return transactions
      .filter(t => monthKey(t.date) === currentMonth)
      .filter(t => resolveParentName(t.category_id, t.categories, categories) === 'Rent')
      .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
  }, [transactions, currentMonth, categories])

  const rentRatio = rentCents > 0 ? (rentCents / MONTHLY_INCOME_CENTS) * 100 : 0
  const rentAlert = rentRatio > 30

  // ── Year-on-Year Category Comparison (dynamic years) ─────────────────────────

  const { yoyData, prevYear, currYear } = useMemo(() => {
    const currYear = perthMonthKey().slice(0, 4)
    const prevYear = String(parseInt(currYear) - 1)

    // Only compare months present in BOTH years (avoids skewed averages)
    const monthsInCurr = new Set(
      transactions.filter(t => t.date.startsWith(currYear)).map(t => t.date.slice(5, 7)),
    )
    const monthsInPrev = new Set(
      transactions.filter(t => t.date.startsWith(prevYear)).map(t => t.date.slice(5, 7)),
    )
    const comparableMonths = new Set([...monthsInCurr].filter(m => monthsInPrev.has(m)))
    const numMonths = comparableMonths.size || 1

    const catTotals: Record<string, { prev: number; curr: number }> = {}
    for (const t of transactions) {
      const [year, month] = t.date.split('-')
      if (!comparableMonths.has(month)) continue
      if (year !== currYear && year !== prevYear) continue

      const catName = resolveParentName(t.category_id, t.categories, categories)
      if (catName === 'Uncategorised' || catName === 'Large One-Off') continue
      if (!catTotals[catName]) catTotals[catName] = { prev: 0, curr: 0 }

      if (year === prevYear) catTotals[catName].prev += Math.abs(t.aud_amount_cents)
      else                   catTotals[catName].curr += Math.abs(t.aud_amount_cents)
    }

    const yoyData = Object.entries(catTotals)
      .map(([cat, v]) => ({
        cat: cat.length > 14 ? cat.slice(0, 13) + '…' : cat,
        [prevYear]: Math.round(v.prev / numMonths / 100),
        [currYear]: Math.round(v.curr / numMonths / 100),
      }))
      .filter(d => (d[prevYear] as number) > 0 || (d[currYear] as number) > 0)
      .sort((a, b) => ((b[prevYear] as number) + (b[currYear] as number)) - ((a[prevYear] as number) + (a[currYear] as number)))
      .slice(0, 8)

    return { yoyData, prevYear, currYear }
  }, [transactions, categories])

  const comparableMonthLabels = useMemo(() => {
    const months = [...new Set(
      transactions
        .filter(t => t.date.startsWith(currYear) || t.date.startsWith(prevYear))
        .map(t => t.date.slice(5, 7)),
    )].filter(m =>
      transactions.some(t => t.date.startsWith(currYear) && t.date.slice(5, 7) === m) &&
      transactions.some(t => t.date.startsWith(prevYear) && t.date.slice(5, 7) === m),
    )
    if (months.length === 0) return 'monthly average'
    const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return months.map(m => abbr[parseInt(m) - 1]).join('–') + ' avg'
  }, [transactions, currYear, prevYear])

  // ── Investment Volatility (by account type, not hardcoded names) ──────────────

  const investInfo = useMemo(() => {
    const investAccounts = accounts.filter(a => a.type === 'investment')
    if (investAccounts.length === 0) return { data: [], investAccounts: [], changes: {} as Record<string, { change: number | null; balance: number }> }

    const accountIds = new Set(investAccounts.map(a => a.id))
    const byDate: Record<string, Record<string, number>> = {}
    for (const s of snapshots) {
      if (!accountIds.has(s.account_id)) continue
      if (!byDate[s.date]) byDate[s.date] = {}
      byDate[s.date][s.account_id] = s.aud_balance_cents
    }

    const dates = Object.keys(byDate).sort()
    const data = dates.map(date => {
      const point: Record<string, number | string> = {
        label: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      }
      for (const a of investAccounts) {
        const v = byDate[date][a.id]
        if (v !== undefined) point[a.name] = Math.round(v / 100)
      }
      return point
    })

    const changes: Record<string, { change: number | null; balance: number }> = {}
    for (const a of investAccounts) {
      const snaps = snapshots.filter(s => s.account_id === a.id).sort((x, y) => x.date.localeCompare(y.date))
      const last = snaps[snaps.length - 1]
      const prev = snaps[snaps.length - 2]
      changes[a.id] = {
        balance: last?.aud_balance_cents ?? 0,
        change: prev && last
          ? ((last.aud_balance_cents - prev.aud_balance_cents) / prev.aud_balance_cents) * 100
          : null,
      }
    }

    return { data, investAccounts, changes }
  }, [snapshots, accounts])

  // ── Personal Allowance ────────────────────────────────────────────────────────

  // 12.10 Reconciliation: flag months where actual NW change ≠ income−expenses by >$500
  const reconciliation = useMemo(() => {
    // Build monthly NW totals: group snapshots by month, sum latest-per-account
    const byMonth = new Map<string, Map<string, { date: string; cents: number }>>()
    for (const s of snapshots) {
      const mk = monthKey(s.date)
      if (!byMonth.has(mk)) byMonth.set(mk, new Map())
      const accts = byMonth.get(mk)!
      const prev  = accts.get(s.account_id)
      if (!prev || s.date > prev.date) accts.set(s.account_id, { date: s.date, cents: s.aud_balance_cents })
    }
    const monthTotals = new Map([...byMonth.entries()].map(([mk, accts]) => [
      mk,
      [...accts.values()].reduce((s, v) => s + v.cents, 0),
    ]))

    const sortedMK = [...monthTotals.keys()].sort()
    const results: { month: string; discrepancyCents: number }[] = []

    for (let i = 1; i < sortedMK.length; i++) {
      const mk    = sortedMK[i]
      const prevMK = sortedMK[i - 1]
      const endNW  = monthTotals.get(mk)!
      const startNW = monthTotals.get(prevMK)!
      const actualChange = endNW - startNW

      // Only expenses are in transactions (income hardcoded)
      const monthExpenses = transactions
        .filter(t => monthKey(t.date) === mk)
        .reduce((s, t) => s + t.aud_amount_cents, 0)  // negative = expenses

      const expectedChange = MONTHLY_INCOME_CENTS + monthExpenses  // income - expenses
      const discrepancy    = Math.abs(actualChange - expectedChange)
      if (discrepancy > 50000) {  // > $500
        results.push({ month: mk, discrepancyCents: discrepancy })
      }
    }
    return results
  }, [snapshots, transactions, MONTHLY_INCOME_CENTS])

  const personalSpending = useMemo(() => ({
    rachel: transactions
      .filter(t => monthKey(t.date) === currentMonth && t.owner === 'rachel')
      .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0),
    evan: transactions
      .filter(t => monthKey(t.date) === currentMonth && t.owner === 'evan')
      .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0),
  }), [transactions, currentMonth])

  // ── Health Scorecard ─────────────────────────────────────────────────────────

  const healthScore = useMemo(() => {
    let score = 0
    if (currentSavings.rate >= 20) score += 2
    else if (currentSavings.rate >= 10) score += 1
    if (rentRatio <= 30) score += 2
    else if (rentRatio <= 40) score += 1
    const allInvestChanges = investInfo.investAccounts.map(a => investInfo.changes[a.id].change)
    if (investInfo.investAccounts.length > 0 && allInvestChanges.every(c => c !== null && c >= 0)) score += 1
    return score
  }, [currentSavings.rate, rentRatio, investInfo])

  // ── Render ────────────────────────────────────────────────────────────────────

  if (allMonths.length === 0) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
        No data yet
      </div>
    )
  }

  const scoreColour = healthScore >= 4 ? 'text-green-400' : healthScore >= 2 ? 'text-yellow-400' : 'text-red-400'
  const dotFilled   = healthScore >= 4 ? 'bg-green-400' : healthScore >= 2 ? 'bg-yellow-400' : 'bg-red-400'

  return (
    <div className="space-y-4 pb-4">

      {/* Financial Health Scorecard */}
      <Card padded={false} className="px-4 py-3">
        <div className="flex items-center justify-between">
          <p className={`text-sm font-semibold ${scoreColour}`}>Financial Health: {healthScore}/5</p>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full ${i < healthScore ? dotFilled : 'bg-gray-700'}`}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* Month nav */}
      <Card padded={false} className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setMonthIdx(i => Math.min(i + 1, allMonths.length - 1))}
          disabled={monthIdx >= allMonths.length - 1}
          className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors p-1"
          aria-label="Previous month"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-white font-semibold">{monthLabel(currentMonth, { month: 'short', year: 'numeric' })}</p>
          <p className="text-[10px] text-gray-500">savings · rent · allowance</p>
        </div>
        <button
          onClick={() => setMonthIdx(i => Math.max(i - 1, 0))}
          disabled={monthIdx <= 0}
          className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors p-1"
          aria-label="Next month"
        >
          <ChevronRight size={20} />
        </button>
      </Card>

      {/* ── Income & Savings ── */}
      <p className="text-xs text-gray-500 uppercase tracking-wider px-1">💰 Income &amp; Savings</p>

      {/* ── Savings Rate ── */}
      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Savings Rate</p>
        <div className="flex items-end gap-3 mb-1">
          <p className={`text-4xl font-bold tabular-nums ${
            currentSavings.rate >= 20 ? 'text-green-400' :
            currentSavings.rate >= 10 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {currentSavings.rate}%
          </p>
          {prevSavingsRate !== null && (
            <div className={`flex items-center gap-1 mb-1 text-sm ${
              currentSavings.rate >= prevSavingsRate ? 'text-green-400' : 'text-red-400'
            }`}>
              {currentSavings.rate >= prevSavingsRate ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span>{currentSavings.rate >= prevSavingsRate ? '+' : ''}{currentSavings.rate - prevSavingsRate}pp</span>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">
          {fmtAUD(currentSavings.savings)} saved · {fmtAUD(currentSavings.spending)} of {fmtAUD(MONTHLY_INCOME_CENTS)} income
        </p>
        {savingsRateData.length > 1 && (
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={savingsRateData} margin={{ top: 0, right: 0, bottom: 0, left: -26 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => v + '%'} domain={[0, 100]} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs shadow-xl">
                      <p className="text-gray-400">{label}</p>
                      <p className="text-white font-medium">{payload[0]?.value}% savings rate</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
                {savingsRateData.map((d, i) => (
                  <Cell key={i} fill={d.rate >= 20 ? '#4ade80' : d.rate >= 10 ? '#facc15' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Housing ── */}
      <p className="text-xs text-gray-500 uppercase tracking-wider px-1">🏠 Housing</p>

      {/* ── Rent-to-Income ── */}
      <Card className={rentAlert ? 'border-red-500/40' : ''}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Rent-to-Income</p>
          {rentAlert && (
            <div className="flex items-center gap-1 text-red-400 text-xs font-medium">
              <AlertTriangle size={12} />
              <span>above 30%</span>
            </div>
          )}
        </div>
        <p className={`text-4xl font-bold tabular-nums ${rentAlert ? 'text-red-400' : 'text-white'}`}>
          {rentRatio.toFixed(1)}%
        </p>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          {fmtAUD(rentCents)} rent / {fmtAUD(MONTHLY_INCOME_CENTS)} income
        </p>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${rentAlert ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${Math.min(100, rentRatio * (100 / 50))}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
          <span>0%</span>
          <span className="text-yellow-600">30% limit</span>
          <span>50%</span>
        </div>
      </Card>

      {/* ── Year-on-Year Comparison ── */}
      {yoyData.length > 0 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white">Year-on-Year</p>
          <p className="text-xs text-gray-500 mb-3 mt-0.5">{comparableMonthLabels} · {prevYear} vs {currYear}</p>
          <ResponsiveContainer width="100%" height={yoyData.length * 38 + 20}>
            <BarChart data={yoyData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)}
              />
              <YAxis type="category" dataKey="cat" tick={{ fontSize: 10, fill: '#9ca3af' }} width={78} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey={prevYear} name={prevYear} fill="#818cf8" radius={[0, 3, 3, 0]} />
              <Bar dataKey={currYear} name={currYear} fill="#34d399" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Investments ── */}
      {investInfo.data.length > 0 && <p className="text-xs text-gray-500 uppercase tracking-wider px-1">📈 Investments</p>}

      {/* ── Investment Volatility ── */}
      {investInfo.data.length > 0 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white mb-3">Investment Volatility</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {investInfo.investAccounts.map((a, i) => {
              const { change, balance } = investInfo.changes[a.id]
              return (
                <div key={a.id} className={`bg-gray-800/50 border ${INVEST_BORDER[i % INVEST_BORDER.length]} rounded-xl p-3`}>
                  <p className={`text-xs ${INVEST_TEXT[i % INVEST_TEXT.length]} mb-1`}>{a.name}</p>
                  <p className="text-sm font-bold text-white">{fmtAUD(balance)}</p>
                  {change !== null ? (
                    <div className={`flex items-center gap-0.5 mt-1 text-xs font-medium ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {change >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                      <span>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</span>
                      <span className="text-gray-500 font-normal ml-0.5">vs prev</span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 mt-1">no prior snapshot</p>
                  )}
                </div>
              )
            })}
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={investInfo.data} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={v => '$' + Math.round(v / 1000) + 'k'}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {investInfo.investAccounts.map((a, i) => (
                <Line
                  key={a.id}
                  type="monotone"
                  dataKey={a.name}
                  name={a.name}
                  stroke={INVEST_COLOURS[i % INVEST_COLOURS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Personal Allowance ── */}
      <Card>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Personal Allowance</p>
        <p className="text-xs text-gray-500 mb-4">{fmtAUD(PERSONAL_BUDGET_CENTS)}/mo budget each</p>
        {([
          { name: 'Rachel', spent: personalSpending.rachel, bar: 'bg-pink-500', label: 'text-pink-300' },
          { name: 'Evan',   spent: personalSpending.evan,   bar: 'bg-sky-500',  label: 'text-sky-300'  },
        ] as const).map(({ name, spent, bar, label }) => {
          const pct  = Math.min(100, (spent / PERSONAL_BUDGET_CENTS) * 100)
          const over = spent > PERSONAL_BUDGET_CENTS
          return (
            <div key={name} className="mb-4 last:mb-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-sm font-medium ${label}`}>{name}</span>
                <div>
                  <span className={`text-sm font-bold tabular-nums ${over ? 'text-red-400' : 'text-white'}`}>
                    {fmtAUD(spent)}
                  </span>
                  <span className="text-xs text-gray-500"> / {fmtAUD(PERSONAL_BUDGET_CENTS)}</span>
                </div>
              </div>
              <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : bar}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {over
                  ? `${fmtAUD(spent - PERSONAL_BUDGET_CENTS)} over budget`
                  : `${fmtAUD(PERSONAL_BUDGET_CENTS - spent)} remaining`}
              </p>
            </div>
          )
        })}
      </Card>

      {/* ── Reconciliation ── */}
      {reconciliation.length > 0 && (
        <Card>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Reconciliation Flags</p>
          <p className="text-xs text-gray-500 mb-3">Months where NW change &gt; $500 off from income − expenses</p>
          <div className="space-y-2">
            {reconciliation.map(r => (
              <div key={r.month} className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{monthLabel(r.month, { month: 'long', year: 'numeric' })}</span>
                <span className="text-sm font-medium text-yellow-300">{fmtAUD(r.discrepancyCents)} gap</span>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  )
}
