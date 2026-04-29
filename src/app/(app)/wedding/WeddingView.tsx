'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip,
} from 'recharts'
import { Heart, Plus, EllipsisVertical, AlertTriangle } from 'lucide-react'
import { deleteWeddingItem } from './actions'
import WeddingItemModal from './WeddingItemModal'
import { Card } from '@/components/Card'

const FALLBACK_COLOURS = ['#818cf8','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa','#f472b6','#fb923c']

export type WeddingItem = {
  id: string
  item: string
  budget_aud_cents: number | null
  budget_eur_cents: number | null
  spent_aud_cents: number | null
  spent_eur_cents: number | null
  balance_owed_eur_cents: number | null
  date_paid: string | null
  status: 'pending' | 'deposit_paid' | 'paid' | 'cancelled' | null
  notes: string | null
  sort_order: number | null
}


const STATUS_STYLES: Record<NonNullable<WeddingItem['status']>, string> = {
  paid:         'bg-green-500/20 text-green-300',
  deposit_paid: 'bg-yellow-500/20 text-yellow-300',
  pending:      'bg-gray-700 text-gray-400',
  cancelled:    'bg-red-500/20 text-red-400 line-through',
}
const STATUS_LABELS: Record<NonNullable<WeddingItem['status']>, string> = {
  paid: 'Paid', deposit_paid: 'Deposit', pending: 'Pending', cancelled: 'Cancelled',
}

export default function WeddingView({ items, budget, eurToAud = 1.65 }: { items: WeddingItem[]; budget: number; eurToAud?: number }) {
  const EUR_TO_AUD = eurToAud
  const [showEur, setShowEur]       = useState(false)
  const [filter, setFilter]         = useState<'all' | 'pending' | 'deposit_paid' | 'paid'>('all')
  const [showAdd, setShowAdd]       = useState(false)
  const [editingItem, setEditingItem] = useState<WeddingItem | null>(null)
  const [menuId, setMenuId]         = useState<string | null>(null)

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuId) return
    function close() { setMenuId(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuId])

  const donutData = useMemo(() => {
    const active = items
      .filter(i => i.status !== 'cancelled' && (i.budget_aud_cents ?? 0) > 0)
      .map(i => ({ name: i.item, value: i.budget_aud_cents ?? 0 }))
      .sort((a, b) => b.value - a.value)

    if (active.length <= 8) return active

    const top7  = active.slice(0, 7)
    const other = active.slice(7).reduce((s, i) => s + i.value, 0)
    return [...top7, { name: 'Other', value: other }]
  }, [items])

  const totalBudgetAud   = budget * 100
  const estimateTotalAud = items.reduce((s, i) => s + (i.budget_aud_cents ?? 0), 0)
  const totalSpentAud    = items.reduce((s, i) => s + (i.spent_aud_cents ?? 0), 0)
  const totalBalanceAud  = items
    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((s, i) => s + Math.max(0, (i.budget_aud_cents ?? 0) - (i.spent_aud_cents ?? 0)), 0)

  const totalSpentPct = totalBudgetAud > 0 ? (totalSpentAud / totalBudgetAud) * 100 : 0
  const estimatePct   = totalBudgetAud > 0 ? (estimateTotalAud / totalBudgetAud) * 100 : 0
  const isOverBudget  = estimateTotalAud > totalBudgetAud

  function fmtAUD(cents: number) {
    return '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  function fmtEUR(cents: number) {
    return '€' + (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }
  function fmtBudget(audCents: number, eurCents: number) {
    if (showEur) return eurCents > 0 ? fmtEUR(eurCents) : fmtAUD(Math.round(audCents / EUR_TO_AUD))
    return fmtAUD(audCents)
  }
  function fmtSpent(audCents: number, eurCents: number) {
    if (showEur) return eurCents > 0 ? fmtEUR(eurCents) : fmtAUD(Math.round(audCents / EUR_TO_AUD))
    return fmtAUD(audCents)
  }

  const visible = items.filter(i => filter === 'all' || i.status === filter)

  async function handleDelete(id: string) {
    setMenuId(null)
    await deleteWeddingItem(id)
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Overspend warning */}
      {isOverBudget && (
        <div className="bg-red-500/15 border border-red-500/40 rounded-2xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">
            Projected estimate ({fmtAUD(estimateTotalAud)}) exceeds {fmtAUD(totalBudgetAud)} ceiling by {fmtAUD(estimateTotalAud - totalBudgetAud)}
          </p>
        </div>
      )}

      {/* Header card */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Heart size={16} className="text-pink-400" fill="currentColor" />
            <p className="text-xs text-gray-500 uppercase tracking-wider">Wedding Budget</p>
          </div>
          <button
            onClick={() => setShowEur(v => !v)}
            aria-label={showEur ? 'Switch to AUD' : 'Switch to EUR'}
            aria-pressed={showEur}
            className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1 text-gray-400 hover:text-white transition-colors"
          >
            {showEur ? 'AUD' : 'EUR'}
          </button>
        </div>

        <p className="text-3xl font-bold text-white mt-1">{fmtAUD(totalBudgetAud)}</p>
        <p className="text-xs text-gray-500 mt-0.5">budget ceiling</p>

        <div className="mt-4 space-y-2">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Estimate ({fmtAUD(estimateTotalAud)})</span>
              <span className={estimatePct > 100 ? 'text-red-400' : 'text-gray-500'}>{estimatePct.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${estimatePct > 100 ? 'bg-red-500' : 'bg-indigo-400/60'}`}
                style={{ width: `${Math.min(estimatePct, 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-pink-300">Spent ({fmtAUD(totalSpentAud)})</span>
              <span className="text-pink-300">{totalSpentPct.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-pink-500 rounded-full" style={{ width: `${Math.min(totalSpentPct, 100)}%` }} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-1">Spent</p>
            <p className="text-sm font-semibold text-white">{fmtAUD(totalSpentAud)}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-1">Still owed</p>
            <p className="text-sm font-semibold text-yellow-300">{fmtAUD(totalBalanceAud)}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-1">Remaining</p>
            <p className="text-sm font-semibold text-green-300">{fmtAUD(totalBudgetAud - totalSpentAud - totalBalanceAud)}</p>
          </div>
        </div>
      </div>

      {/* Budget by Item donut */}
      {donutData.length > 0 && (
        <Card padded={false} className="p-4">
          <p className="text-sm font-semibold text-white mb-3">Budget by Item</p>
          <div className="flex gap-3 items-start">
            <div className="w-40 h-40 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={68}
                    dataKey="value"
                    labelLine={false}
                  >
                    {donutData.map((_, i) => (
                      <Cell key={i} fill={FALLBACK_COLOURS[i % FALLBACK_COLOURS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0]
                      return (
                        <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs shadow-xl">
                          <p className="text-white font-medium">{d.name}</p>
                          <p className="text-gray-300">${((d.value as number) / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}</p>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-1.5 overflow-hidden">
              {donutData.map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: FALLBACK_COLOURS[i % FALLBACK_COLOURS.length] }} />
                    <span className="text-xs text-gray-300 truncate">{d.name}</span>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                    ${Math.round(d.value / 100).toLocaleString('en-AU')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Payment Status strip */}
      {(() => {
        const paidAud    = items.filter(i => i.status === 'paid').reduce((s, i) => s + (i.budget_aud_cents ?? 0), 0)
        const depositAud = items.filter(i => i.status === 'deposit_paid').reduce((s, i) => s + (i.budget_aud_cents ?? 0), 0)
        const pendingAud = items.filter(i => i.status === 'pending').reduce((s, i) => s + (i.budget_aud_cents ?? 0), 0)
        const stripTotal = paidAud + depositAud + pendingAud
        if (stripTotal === 0) return null
        return (
          <div className="bg-gray-800/50 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-2">Payment Status</p>
            <div className="h-5 rounded-full overflow-hidden flex gap-0.5">
              {paidAud > 0 && (
                <div style={{ width: `${(paidAud / stripTotal) * 100}%` }} className="bg-emerald-400 rounded-l-full" />
              )}
              {depositAud > 0 && (
                <div style={{ width: `${(depositAud / stripTotal) * 100}%` }} className="bg-yellow-400" />
              )}
              {pendingAud > 0 && (
                <div style={{ width: `${(pendingAud / stripTotal) * 100}%` }} className="bg-gray-600 rounded-r-full flex-1" />
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                <span className="text-gray-300">Paid</span>
                <span className="text-gray-400">{fmtAUD(paidAud)}</span>
              </span>
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                <span className="text-gray-300">Deposit</span>
                <span className="text-gray-400">{fmtAUD(depositAud)}</span>
              </span>
              <span className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" />
                <span className="text-gray-300">Pending</span>
                <span className="text-gray-400">{fmtAUD(pendingAud)}</span>
              </span>
            </div>
          </div>
        )
      })()}

      {/* Filter tabs */}
      <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-xs">
        {(['all', 'pending', 'deposit_paid', 'paid'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 px-2 py-2 font-medium transition-colors capitalize ${filter === f ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {f === 'deposit_paid' ? 'Deposit' : f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Items list */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
        {visible.length === 0 && <div className="p-6 text-center text-sm text-gray-500">No items</div>}
        {visible.map(item => {
          const budgetAud = item.budget_aud_cents ?? 0
          const spentAud  = item.spent_aud_cents ?? 0
          const remaining = budgetAud - spentAud
          const pct       = budgetAud > 0 ? Math.min(100, (spentAud / budgetAud) * 100) : 0

          return (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm text-white ${item.status === 'cancelled' ? 'line-through text-gray-500' : ''}`}>
                      {item.item}
                    </p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-md flex-shrink-0 ${STATUS_STYLES[item.status ?? 'pending']}`}>
                      {STATUS_LABELS[item.status ?? 'pending']}
                    </span>
                  </div>
                  {item.notes && <p className="text-xs text-gray-400 mt-0.5">{item.notes}</p>}
                  {budgetAud > 0 && item.status !== 'pending' && (
                    <div className="mt-1.5 h-1 bg-gray-800 rounded-full overflow-hidden w-full max-w-[180px]">
                      <div className={`h-full rounded-full ${item.status === 'paid' ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-white tabular-nums">
                    {fmtBudget(budgetAud, item.budget_eur_cents ?? 0)}
                  </p>
                  {spentAud > 0 && <p className="text-xs text-pink-400 mt-0.5">{fmtSpent(spentAud, item.spent_eur_cents ?? 0)} paid</p>}
                  {remaining > 0 && item.status !== 'paid' && item.status !== 'pending' && (
                    <p className="text-xs text-yellow-400 mt-0.5">{fmtAUD(remaining)} owed</p>
                  )}
                </div>

                {/* Row overflow menu */}
                <div className="flex-shrink-0 relative">
                  <button
                    onClick={e => { e.stopPropagation(); setMenuId(menuId === item.id ? null : item.id) }}
                    aria-label="Item actions"
                    className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
                  >
                    <EllipsisVertical size={15} />
                  </button>
                  {menuId === item.id && (
                    <div className="absolute right-0 top-7 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[110px]"
                      onClick={e => e.stopPropagation()}>
                      <button className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                        onClick={() => { setEditingItem(item); setMenuId(null) }}>Edit</button>
                      <button className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                        onClick={() => handleDelete(item.id)}>Delete</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 12.7 FX risk card */}
      {(() => {
        const eurExposureCents = items
          .filter(i => i.status !== 'paid' && i.status !== 'cancelled' && (i.budget_eur_cents ?? 0) > 0)
          .reduce((s, i) => s + (i.budget_eur_cents ?? 0), 0)
        if (eurExposureCents === 0) return null
        const eurAmt = eurExposureCents / 100
        const base   = EUR_TO_AUD
        const lo     = base - 0.10
        const hi     = base + 0.10
        return (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">EUR Exposure Risk</p>
            <p className="text-sm text-gray-300 mb-3">
              €{eurAmt.toLocaleString('en-AU', { maximumFractionDigits: 0 })} remaining in EUR-denominated items
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Rate ' + lo.toFixed(2), lo], ['Rate ' + base.toFixed(2) + ' (now)', base], ['Rate ' + hi.toFixed(2), hi]].map(([label, rate]) => (
                <div key={String(rate)} className="bg-gray-800 rounded-xl p-2">
                  <p className="text-[10px] text-gray-500 mb-1">{label}</p>
                  <p className={`text-sm font-semibold ${rate === lo ? 'text-green-300' : rate === hi ? 'text-red-300' : 'text-white'}`}>
                    ${Math.round(eurAmt * (rate as number)).toLocaleString('en-AU')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <p className="text-xs text-gray-500 text-center px-4">
        EUR/AUD rate ~{EUR_TO_AUD.toFixed(2)} · Budget ceiling {fmtAUD(totalBudgetAud)} · Estimate {fmtAUD(estimateTotalAud)}
      </p>

      {/* Add FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-24 right-4 w-14 h-14 bg-pink-600 hover:bg-pink-500 rounded-full flex items-center justify-center shadow-lg shadow-pink-900/50 transition-colors z-20"
        aria-label="Add wedding item"
      >
        <Plus size={24} className="text-white" />
      </button>

      {showAdd && (
        <WeddingItemModal nextSortOrder={items.length} onClose={() => setShowAdd(false)} />
      )}
      {editingItem && (
        <WeddingItemModal editing={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  )
}
