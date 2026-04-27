'use client'

import { useState, useId } from 'react'
import Link from 'next/link'
import { Upload, ChevronRight, Check, AlertTriangle } from 'lucide-react'
import { commitImport, type ImportRow } from './actions'
import { matchCategory } from '@/lib/categorise'
import type { Category, Account } from '../TransactionList'
import { fmtAUD } from '@/lib/format'

type Rule = { pattern: string; category_id: string; owner: string | null; priority: number; is_active: boolean }

// Expected columns in the CSV
const EXPECTED_COLS = ['date', 'description', 'amount', 'currency', 'owner', 'account', 'category', 'notes'] as const
type ColName = (typeof EXPECTED_COLS)[number]

type ParsedRow = {
  date: string
  description: string
  amountRaw: string
  currency: string
  owner: 'joint' | 'rachel' | 'evan'
  accountName: string
  categoryName: string
  notes: string
  // resolved
  account_id: string
  category_id: string
  amount_cents: number
  aud_amount_cents: number
  error?: string
}

type Step = 'upload' | 'map' | 'preview' | 'done'

type Props = {
  categories: Category[]
  accounts: Account[]
  rules: Rule[]
}

export default function CsvImport({ categories, accounts, rules }: Props) {
  const uid = useId()
  const [step, setStep]             = useState<Step>('upload')
  const [headers, setHeaders]       = useState<string[]>([])
  const [rawRows, setRawRows]       = useState<string[][]>([])
  const [colMap, setColMap]         = useState<Partial<Record<ColName, string>>>({})
  const [preview, setPreview]       = useState<ParsedRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState<{ imported: number; error?: string } | null>(null)

  function parseCSV(text: string): { headers: string[]; rows: string[][] } {
    const lines = text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    function splitLine(line: string) {
      const out: string[] = []
      let inQ = false, cur = ''
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = '' }
        else cur += ch
      }
      out.push(cur.trim())
      return out
    }
    return { headers: splitLine(lines[0]), rows: lines.slice(1).map(splitLine) }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const { headers: h, rows } = parseCSV(text)
      setHeaders(h)
      setRawRows(rows)
      // Auto-map obvious column names
      const auto: Partial<Record<ColName, string>> = {}
      for (const col of EXPECTED_COLS) {
        const match = h.find(hh => hh.toLowerCase().replace(/[^a-z]/g, '').includes(col.replace(/[^a-z]/g, '')))
        if (match) auto[col] = match
      }
      setColMap(auto)
      setStep('map')
    }
    reader.readAsText(file)
  }

  function buildPreview() {
    const categoryByName: Record<string, string> = {}
    for (const c of categories) categoryByName[c.name.toLowerCase()] = c.id
    const accountByName: Record<string, Account> = {}
    for (const a of accounts) accountByName[a.name.toLowerCase()] = a

    const idx = (col: ColName) => headers.indexOf(colMap[col] ?? '')
    const parsed: ParsedRow[] = rawRows
      .filter(r => r.some(c => c.trim()))
      .map(r => {
        const get = (col: ColName) => (idx(col) >= 0 ? (r[idx(col)] ?? '') : '').trim()
        const amountRaw   = get('amount')
        const amtNum      = parseFloat(amountRaw.replace(/[^0-9.-]/g, ''))
        const currency    = get('currency') || 'AUD'
        const ownerRaw    = get('owner').toLowerCase()
        const owner       = (['joint','rachel','evan'].includes(ownerRaw) ? ownerRaw : 'joint') as 'joint'|'rachel'|'evan'
        const accountName = get('account')
        const categoryName = get('category')
        const account     = accountByName[accountName.toLowerCase()]
        const account_id  = account?.id ?? ''
        const catId       = categoryByName[categoryName.toLowerCase()] ??
                            matchCategory(get('description'), owner, rules) ?? ''
        const cents       = isNaN(amtNum) ? 0 : Math.round(amtNum * 100)
        const errors: string[] = []
        if (!get('date')) errors.push('no date')
        if (!get('description')) errors.push('no description')
        if (isNaN(amtNum)) errors.push('bad amount')
        if (!account_id) errors.push(`unknown account "${accountName}"`)

        return {
          date: get('date'),
          description: get('description'),
          amountRaw,
          currency,
          owner,
          accountName,
          categoryName,
          notes: get('notes'),
          account_id,
          category_id: catId,
          amount_cents: cents,
          aud_amount_cents: cents,
          error: errors.length ? errors.join(', ') : undefined,
        }
      })
    setPreview(parsed)
    setStep('preview')
  }

  async function handleCommit() {
    const valid = preview.filter(r => !r.error)
    if (valid.length === 0) return
    setSubmitting(true)
    const rows: ImportRow[] = valid.map(r => ({
      date: r.date,
      description: r.description,
      amount_cents: r.amount_cents,
      aud_amount_cents: r.aud_amount_cents,
      currency: r.currency,
      account_id: r.account_id,
      category_id: r.category_id,
      owner: r.owner,
      is_large_one_off: false,
      notes: r.notes || undefined,
    }))
    const res = await commitImport(rows)
    setResult(res)
    setStep('done')
    setSubmitting(false)
  }

  const input  = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl    = 'block text-xs font-medium text-gray-400 mb-1.5'
  const validRows   = preview.filter(r => !r.error)
  const invalidRows = preview.filter(r => !!r.error)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/transactions" className="text-indigo-400 hover:text-indigo-300 text-sm">← Transactions</Link>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-gray-300">Import CSV</span>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 text-xs">
        {(['upload','map','preview','done'] as Step[]).map((s, i, arr) => (
          <div key={s} className="flex items-center gap-1">
            <span className={`capitalize ${step === s ? 'text-indigo-400 font-medium' : 'text-gray-600'}`}>
              {i + 1}. {s}
            </span>
            {i < arr.length - 1 && <ChevronRight size={12} className="text-gray-700" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 text-center space-y-4">
          <Upload size={40} className="text-gray-600 mx-auto" />
          <div>
            <p className="text-white font-medium">Upload a CSV file</p>
            <p className="text-xs text-gray-500 mt-1">
              Columns: Date, Description, Amount, Currency, Owner, Account, Category, Notes
            </p>
          </div>
          <label htmlFor={`${uid}file`} className="cursor-pointer inline-block bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
            Choose file
            <input id={`${uid}file`} type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
          </label>
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === 'map' && (
        <div className="space-y-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
            <p className="text-sm font-medium text-white">Map your CSV columns ({rawRows.length} rows detected)</p>
            <div className="grid grid-cols-2 gap-3">
              {EXPECTED_COLS.map(col => (
                <div key={col}>
                  <label htmlFor={`${uid}${col}`} className={lbl}>{col} {['date','description','amount','owner','account'].includes(col) ? '*' : ''}</label>
                  <select
                    id={`${uid}${col}`}
                    value={colMap[col] ?? ''}
                    onChange={e => setColMap(m => ({ ...m, [col]: e.target.value }))}
                    className={input}
                  >
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={buildPreview}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl py-3 transition-colors text-sm"
          >
            Preview →
          </button>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">{validRows.length} valid · {invalidRows.length} errors</span>
            <button onClick={() => setStep('map')} className="text-xs text-indigo-400 hover:text-indigo-300">← Back</button>
          </div>

          {invalidRows.length > 0 && (
            <div className="bg-red-900/30 border border-red-800 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
                <AlertTriangle size={14} /> {invalidRows.length} rows will be skipped
              </div>
              {invalidRows.slice(0, 3).map((r, i) => (
                <p key={i} className="text-xs text-red-300 truncate">{r.description || '(blank)'} — {r.error}</p>
              ))}
              {invalidRows.length > 3 && <p className="text-xs text-red-400">+{invalidRows.length - 3} more</p>}
            </div>
          )}

          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 text-xs text-gray-500 grid grid-cols-[1fr_1fr_auto] gap-2">
              <span>Description</span><span>Date</span><span>Amount</span>
            </div>
            <div className="divide-y divide-gray-800 max-h-80 overflow-y-auto">
              {validRows.slice(0, 50).map((r, i) => (
                <div key={i} className="px-4 py-2.5 grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <span className="text-sm text-white truncate">{r.description}</span>
                  <span className="text-xs text-gray-500">{r.date}</span>
                  <span className={`text-sm tabular-nums font-medium ${r.amount_cents < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {fmtAUD(r.amount_cents)}
                  </span>
                </div>
              ))}
              {validRows.length > 50 && (
                <div className="px-4 py-3 text-xs text-gray-500">…and {validRows.length - 50} more</div>
              )}
            </div>
          </div>

          <button
            onClick={handleCommit}
            disabled={submitting || validRows.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-colors text-sm"
          >
            {submitting ? 'Importing…' : `Import ${validRows.length} transaction${validRows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && result && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center space-y-4">
          {result.error ? (
            <>
              <AlertTriangle size={40} className="text-red-400 mx-auto" />
              <p className="text-white font-medium">Import failed</p>
              <p className="text-sm text-red-400">{result.error}</p>
            </>
          ) : (
            <>
              <Check size={40} className="text-green-400 mx-auto" />
              <p className="text-white font-medium">{result.imported} transaction{result.imported !== 1 ? 's' : ''} imported</p>
            </>
          )}
          <Link href="/transactions" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">
            View transactions →
          </Link>
        </div>
      )}
    </div>
  )
}
