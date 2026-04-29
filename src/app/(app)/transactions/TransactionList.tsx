'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Plus, Download, Search, X, ChevronUp, ChevronDown, Undo2, EllipsisVertical, Upload } from 'lucide-react'
import { deleteTransaction } from './actions'
import AddTransactionModal from './AddTransactionModal'
import SpendSummary from './SpendSummary'
import { fmtAUD, fmtDate, monthKey, monthLabel } from '@/lib/format'
import { OWNER_BADGE } from '@/lib/owners'
import type { OwnerKey } from '@/lib/types'
import { csvSafe } from '@/lib/csv'

// ── Types ─────────────────────────────────────────────────────────────────────

type TxCategory = { id: string; name: string; colour: string | null } | null
type TxAccount  = { id: string; name: string } | null

export type Transaction = {
  id: string
  date: string
  description: string
  amount_cents: number
  aud_amount_cents: number
  currency: string
  fx_rate: number | null
  owner: OwnerKey
  is_large_one_off: boolean
  notes: string | null
  account_id: string
  category_id: string | null
  categories: TxCategory
  accounts: TxAccount
}

export type Category = {
  id: string
  name: string
  parent_id: string | null
  owner: string
  colour: string | null
}

export type Account = {
  id: string
  name: string
  type: string
  owner: string
  currency: string
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(rows: Transaction[]) {
  const header = ['Date', 'Description', 'Amount (AUD)', 'Category', 'Account', 'Owner', 'Notes']
  const lines = rows.map(t => [
    t.date,
    `"${csvSafe(t.description).replace(/"/g, '""')}"`,
    (t.aud_amount_cents / 100).toFixed(2),
    csvSafe(t.categories?.name ?? ''),
    csvSafe(t.accounts?.name ?? ''),
    t.owner,
    `"${csvSafe(t.notes ?? '').replace(/"/g, '""')}"`,
  ].join(','))
  const csv = [header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'transactions.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  fromDate: string | null   // null = all data loaded; non-null = filtered to last 90d
}

type SortKey = 'date' | 'amount'
type TxTypeFilter = 'all' | 'expense' | 'income'

function SortIcon({ sortKey, k, sortAsc }: { sortKey: SortKey; k: SortKey; sortAsc: boolean }) {
  if (sortKey !== k) return null
  return sortAsc ? <ChevronUp size={14} className="inline" /> : <ChevronDown size={14} className="inline" />
}

export default function TransactionList({ transactions, categories, accounts, fromDate }: Props) {
  const [search, setSearch]         = useState('')
  const [owner, setOwner]           = useState<'all' | OwnerKey>('all')
  const [month, setMonth]           = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<TxTypeFilter>('all')
  const [sortKey, setSortKey]       = useState<SortKey>('date')
  const [sortAsc, setSortAsc]       = useState(false)
  const [showAdd, setShowAdd]       = useState(false)
  const [editingTx, setEditingTx]   = useState<Transaction | null>(null)
  const [menuId, setMenuId]         = useState<string | null>(null)
  const [lastAddedId, setLastAddedId] = useState<string | null>(null)
  const [undoError, setUndoError]   = useState(false)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuId) return
    function close() { setMenuId(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuId])

  // Derive available months from transaction data
  const months = useMemo(() => {
    const keys = [...new Set(transactions.map(t => monthKey(t.date)))].sort().reverse()
    return keys
  }, [transactions])

  // Filter + sort
  const filtered = useMemo(() => {
    let rows = transactions
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(t =>
        t.description.toLowerCase().includes(q) ||
        (t.categories?.name ?? '').toLowerCase().includes(q) ||
        (t.accounts?.name ?? '').toLowerCase().includes(q)
      )
    }
    if (owner !== 'all') rows = rows.filter(t => t.owner === owner)
    if (month !== 'all') rows = rows.filter(t => monthKey(t.date) === month)
    if (typeFilter === 'expense') rows = rows.filter(t => t.aud_amount_cents < 0)
    if (typeFilter === 'income')  rows = rows.filter(t => t.aud_amount_cents > 0)

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') cmp = a.date.localeCompare(b.date)
      if (sortKey === 'amount') cmp = Math.abs(a.aud_amount_cents) - Math.abs(b.aud_amount_cents)
      return sortAsc ? cmp : -cmp
    })
    return rows
  }, [transactions, search, owner, month, typeFilter, sortKey, sortAsc])

  const expenseCents = useMemo(() => filtered.filter(t => t.aud_amount_cents < 0).reduce((s, t) => s + t.aud_amount_cents, 0), [filtered])
  const incomeCents  = useMemo(() => filtered.filter(t => t.aud_amount_cents > 0).reduce((s, t) => s + t.aud_amount_cents, 0), [filtered])
  const netCents     = expenseCents + incomeCents

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  function handleAdded(id: string) {
    setShowAdd(false)
    setLastAddedId(id)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setLastAddedId(null), 6000)
  }

  async function handleDelete(id: string) {
    setMenuId(null)
    const result = await deleteTransaction(id)
    if (result.error) {
      setUndoError(true)
      setTimeout(() => setUndoError(false), 4000)
    }
  }

  async function handleUndo() {
    if (!lastAddedId) return
    const id = lastAddedId
    setLastAddedId(null)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    const result = await deleteTransaction(id)
    if (result.error) {
      setUndoError(true)
      setTimeout(() => setUndoError(false), 4000)
    }
  }

  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }, [])

  return (
    <div className="space-y-3 pb-4">
      {/* Category spend summary */}
      {transactions.length > 0 && <SpendSummary transactions={transactions} />}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex gap-2 flex-wrap">
        {/* Type filter */}
        <div className="flex bg-gray-900 border border-gray-700 rounded-xl overflow-hidden text-xs">
          {([['all', 'All'], ['expense', 'Exp'], ['income', 'Inc']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTypeFilter(v)}
              className={`px-3 py-2 font-medium transition-colors ${typeFilter === v ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Owner tabs */}
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

        {/* Month */}
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 min-w-0"
        >
          <option value="all">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>

        {/* Export */}
        <button
          onClick={() => exportCsv(filtered)}
          title="Export CSV"
          className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-gray-400 hover:text-white transition-colors"
        >
          <Download size={16} />
        </button>

        {/* Import */}
        <Link
          href={'/transactions/import' as import('next').Route}
          title="Import CSV"
          className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-gray-400 hover:text-white transition-colors"
        >
          <Upload size={16} />
        </Link>

        {/* Income */}
        <Link
          href={'/income' as import('next').Route}
          title="Income"
          className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors font-medium"
        >
          Inc
        </Link>
      </div>

      {/* Summary + sort */}
      <div className="flex items-center justify-between text-xs text-gray-500 px-1">
        <span>
          {filtered.length} txn{filtered.length !== 1 ? 's' : ''}
          {typeFilter === 'expense' && expenseCents !== 0 && ` · ${fmtAUD(expenseCents, { signed: true })}`}
          {typeFilter === 'income'  && incomeCents  !== 0 && ` · ${fmtAUD(incomeCents,  { signed: true })}`}
          {typeFilter === 'all'     && netCents      !== 0 && ` · net ${fmtAUD(netCents, { signed: true })}`}
        </span>
        <div className="flex gap-3">
          <button onClick={() => toggleSort('date')} className="hover:text-gray-300 transition-colors">
            Date <SortIcon sortKey={sortKey} k="date" sortAsc={sortAsc} />
          </button>
          <button onClick={() => toggleSort('amount')} className="hover:text-gray-300 transition-colors">
            Amount <SortIcon sortKey={sortKey} k="amount" sortAsc={sortAsc} />
          </button>
        </div>
      </div>

      {/* 90-day filter notice */}
      {fromDate && (
        <div className="flex items-center justify-between text-xs text-gray-600 px-1">
          <span>Showing from {fmtDate(fromDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <Link href="/transactions?all=1" className="text-indigo-500 hover:text-indigo-400 transition-colors">
            Load all →
          </Link>
        </div>
      )}

      {/* Transaction rows */}
      {filtered.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
          No transactions found
        </div>
      ) : (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 overflow-hidden">
          {filtered.map(t => (
            <div key={t.id} className={`flex items-center gap-3 px-4 py-3 relative ${t.id === lastAddedId ? 'bg-indigo-900/30' : ''}`}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.categories?.colour ?? '#6b7280' }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white truncate">{t.description}</span>
                  {t.is_large_one_off && (
                    <span className="text-xs bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded-md flex-shrink-0">one-off</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500">{fmtDate(t.date)}</span>
                  {t.categories && <span className="text-xs text-gray-500">· {t.categories.name}</span>}
                  {t.accounts && <span className="text-xs text-gray-400">· {t.accounts.name}</span>}
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <div className={`text-sm font-medium tabular-nums ${t.aud_amount_cents < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {fmtAUD(t.aud_amount_cents, { signed: true, full: true })}
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded-md mt-0.5 inline-block ${OWNER_BADGE[t.owner]}`}>{t.owner}</span>
              </div>

              {/* Row overflow menu */}
              <div className="flex-shrink-0 relative">
                <button
                  onClick={e => { e.stopPropagation(); setMenuId(menuId === t.id ? null : t.id) }}
                  aria-label="Row actions"
                  className="p-1 text-gray-600 hover:text-gray-300 transition-colors rounded"
                >
                  <EllipsisVertical size={15} />
                </button>
                {menuId === t.id && (
                  <div
                    className="absolute right-0 top-7 z-20 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[110px]"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                      onClick={() => { setEditingTx(t); setMenuId(null) }}
                    >
                      Edit
                    </button>
                    <button
                      className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                      onClick={() => handleDelete(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-24 right-4 w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center shadow-lg shadow-indigo-900/50 transition-colors z-20"
        aria-label="Add transaction"
      >
        <Plus size={24} className="text-white" />
      </button>

      {/* Undo error toast */}
      {undoError && (
        <div className="fixed bottom-24 left-4 right-4 z-20">
          <div className="bg-red-900/80 border border-red-700 rounded-2xl px-4 py-3 text-sm text-red-200 shadow-xl">
            Failed to undo — transaction was not deleted
          </div>
        </div>
      )}

      {/* Undo toast */}
      {lastAddedId && (
        <div className="fixed bottom-24 left-4 right-20 z-20">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 flex items-center justify-between shadow-xl">
            <span className="text-sm text-gray-300">Transaction added</span>
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 text-sm text-indigo-400 font-medium hover:text-indigo-300 transition-colors"
            >
              <Undo2 size={14} />
              Undo
            </button>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <AddTransactionModal
          categories={categories}
          accounts={accounts}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}

      {/* Edit modal */}
      {editingTx && (
        <AddTransactionModal
          categories={categories}
          accounts={accounts}
          editing={editingTx}
          onClose={() => setEditingTx(null)}
          onAdded={() => setEditingTx(null)}
        />
      )}
    </div>
  )
}
