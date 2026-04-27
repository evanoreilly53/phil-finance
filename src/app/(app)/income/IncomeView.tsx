'use client'

import { useState, useMemo } from 'react'
import { fmtAUD, fmtDate, monthKey, monthLabel } from '@/lib/format'
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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Income</h1>

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
