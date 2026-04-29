'use client'

import { useState, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ComposedChart, Line,
} from 'recharts'
import { fmtAUD, fmtDate, monthKey, monthLabel } from '@/lib/format'
import ChartTooltip from '@/components/ChartTooltip'
import { Card } from '@/components/Card'
import type { Transaction, Category, Account } from '../transactions/TransactionList'
import type { OwnerKey } from '@/lib/types'

type YtdEntry = { key: OwnerKey; label: string; ytdCents: number; expectedCents: number }

type Props = {
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  ytd: YtdEntry[]
  jointYtdCents: number
  monthlyIncomeCents: number
}

export default function IncomeView({ transactions, ytd, jointYtdCents, monthlyIncomeCents }: Props) {
  const [owner, setOwner] = useState<'all' | OwnerKey>('all')
  const [month, setMonth] = useState<string>('all')

  const months = useMemo(() => {
    const keys = [...new Set(transactions.map(t => monthKey(t.date)))].sort().reverse()
    return keys
  }, [transactions])

  const filtered = useMemo(() => {
    let rows = transactions
    if (owner !== 'all') rows = rows.filter(t => t.owner === owner)
    if (month !== 'all') rows = rows.filter(t => monthKey(t.date) === month)
    return rows.sort((a, b) => b.date.localeCompare(a.date))
  }, [transactions, owner, month])

  const totalFiltered = filtered.reduce((s, t) => s + t.aud_amount_cents, 0)
  const totalYtd = ytd.reduce((s, e) => s + e.ytdCents, 0) + jointYtdCents

  const allMonthKeys6 = useMemo(() =>
    [...new Set(transactions.map(t => monthKey(t.date)))].sort().reverse().slice(0, 6).reverse(),
    [transactions],
  )

  const incomeBarData = useMemo(() => {
    return allMonthKeys6.map(mk => {
      const monthTxs = transactions.filter(t => monthKey(t.date) === mk && t.aud_amount_cents > 0)
      return {
        label: monthLabel(mk, { month: 'short', year: '2-digit' }),
        Joint:  Math.round(monthTxs.filter(t => t.owner === 'joint').reduce((s, t) => s + t.aud_amount_cents, 0) / 100),
        Rachel: Math.round(monthTxs.filter(t => t.owner === 'rachel').reduce((s, t) => s + t.aud_amount_cents, 0) / 100),
        Evan:   Math.round(monthTxs.filter(t => t.owner === 'evan').reduce((s, t) => s + t.aud_amount_cents, 0) / 100),
      }
    })
  }, [transactions, allMonthKeys6])

  const incomeVsSpendData = useMemo(() => {
    return allMonthKeys6.map(mk => {
      const incomeCents  = transactions
        .filter(t => monthKey(t.date) === mk && t.aud_amount_cents > 0)
        .reduce((s, t) => s + t.aud_amount_cents, 0)
      const spendCents   = transactions
        .filter(t => monthKey(t.date) === mk && t.aud_amount_cents < 0)
        .reduce((s, t) => s + Math.abs(t.aud_amount_cents), 0)
      const income  = Math.round(incomeCents / 100)
      const spending = Math.round(spendCents / 100)
      return {
        label: monthLabel(mk, { month: 'short', year: '2-digit' }),
        income,
        spending,
        savings: income - spending,
      }
    })
  }, [transactions, allMonthKeys6])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Income</h1>

      {/* Monthly income bar chart */}
      {incomeBarData.length > 0 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white mb-3">Monthly Income</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={incomeBarData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Joint"  name="Joint"  fill="#818cf8" radius={[2,2,0,0]} stackId="a" />
              <Bar dataKey="Rachel" name="Rachel" fill="#f472b6" radius={[2,2,0,0]} stackId="a" />
              <Bar dataKey="Evan"   name="Evan"   fill="#60a5fa" radius={[2,2,0,0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Income vs. Spending chart */}
      {incomeVsSpendData.length > 0 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white mb-3">Income vs. Spending</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={incomeVsSpendData} margin={{ top: 4, right: 12, bottom: 0, left: -20 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#60a5fa' }} tickFormatter={v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="income"   name="Income"   fill="#34d399" radius={[2, 2, 0, 0]} />
              <Bar yAxisId="left" dataKey="spending" name="Spending" fill="#f87171" radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="savings" name="Net Savings" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* YTD summary cards */}
      <div className="grid grid-cols-2 gap-3">
        {ytd.map(({ key, label, ytdCents, expectedCents }) => {
          const pct = expectedCents > 0 ? Math.round((ytdCents / expectedCents) * 100) : 0
          return (
            <div key={key} className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
              <p className="text-xs text-gray-400">{label} — YTD</p>
              <p className="text-lg font-semibold text-white mt-1">{fmtAUD(ytdCents)}</p>
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">vs expected</span>
                  <span className={pct >= 90 ? 'text-green-400' : 'text-yellow-400'}>{pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? 'bg-green-500' : 'bg-yellow-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1">Expected {fmtAUD(expectedCents)}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Total YTD */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 px-4 py-4 flex justify-between items-center">
        <div>
          <p className="text-xs text-gray-400">Total Household YTD Income</p>
          <p className="text-2xl font-bold text-white mt-0.5">{fmtAUD(totalYtd)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Monthly budget</p>
          <p className="text-sm text-gray-300">{fmtAUD(monthlyIncomeCents)}/mo</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-xs">
          {(['all', 'joint', 'rachel', 'evan'] as const).map(o => (
            <button
              key={o}
              onClick={() => setOwner(o)}
              className={`px-3 py-2 font-medium transition-colors capitalize ${owner === o ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {o}
            </button>
          ))}
        </div>

        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 min-w-0"
        >
          <option value="all">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>

      {/* Summary line */}
      <div className="text-xs text-gray-500 px-1">
        {filtered.length} transaction{filtered.length !== 1 ? 's' : ''} · {fmtAUD(totalFiltered)}
      </div>

      {/* Income rows */}
      {filtered.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
          No income recorded
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
          {filtered.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.categories?.colour ?? '#22c55e' }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{t.description}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500">{fmtDate(t.date)}</span>
                  {t.categories && <span className="text-xs text-gray-500">· {t.categories.name}</span>}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-medium text-green-400 tabular-nums">{fmtAUD(t.aud_amount_cents, { signed: true, full: true })}</p>
                <span className="text-xs text-gray-500 capitalize">{t.owner}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
