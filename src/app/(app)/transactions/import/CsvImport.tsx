'use client'

import { useState, useId, useMemo } from 'react'
import Link from 'next/link'
import { Upload, ChevronRight, Check, AlertTriangle } from 'lucide-react'
import { commitImport, type ImportRow } from './actions'
import type { Category, Account } from '../TransactionList'
import { fmtAUD } from '@/lib/format'
import {
  parseCsv, parseRate, resolveImportRow, IMPORT_COLS, type ImportCol,
} from '@/lib/csvImport'

type Rule = { pattern: string; category_id: string; owner: string | null; priority: number; is_active: boolean }

// Expected columns in the CSV
const EXPECTED_COLS = IMPORT_COLS
type ColName = ImportCol
const REQUIRED_COLS: readonly ColName[] = ['date', 'description', 'amount', 'owner', 'account']

type Step = 'upload' | 'map' | 'preview' | 'done'

type Props = {
  categories: Category[]
  accounts: Account[]
  rules: Rule[]
  /** Latest stored AUD-per-unit rate by currency, from fx_rates (may be empty) */
  latestRates: Record<string, { rate: number; date: string }>
}

export default function CsvImport({ categories, accounts, rules, latestRates }: Props) {
  const uid = useId()
  const [step, setStep]             = useState<Step>('upload')
  const [headers, setHeaders]       = useState<string[]>([])
  const [rawRows, setRawRows]       = useState<string[][]>([])
  const [colMap, setColMap]         = useState<Partial<Record<ColName, string>>>({})
  // Fallback FX rate per currency for rows without an fx_rate cell (typed by the user)
  const [rateInputs, setRateInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(latestRates).map(([c, r]) => [c, String(r.rate)])),
  )
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState<{ imported: number; error?: string } | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const { headers: h, rows } = parseCsv(text)
      setHeaders(h)
      setRawRows(rows)
      // Auto-map obvious column names
      const auto: Partial<Record<ColName, string>> = {}
      for (const col of EXPECTED_COLS) {
        const key = col.replace(/[^a-z]/g, '')
        const match =
          h.find(hh => hh.toLowerCase().replace(/[^a-z]/g, '') === key) ??
          h.find(hh => hh.toLowerCase().replace(/[^a-z]/g, '').includes(key))
        if (match) auto[col] = match
      }
      setColMap(auto)
      setStep('map')
    }
    reader.readAsText(file)
  }

  // Preview is derived, so editing an FX rate re-converts every row immediately
  const preview = useMemo(() => {
    if (step !== 'preview' && step !== 'done') return []
    const defaultRates = Object.fromEntries(
      Object.entries(rateInputs).map(([c, v]) => [c, parseRate(v)]),
    )
    const idx = (col: ColName) => headers.indexOf(colMap[col] ?? '')
    return rawRows
      .filter(r => r.some(c => c.trim()))
      .map(r => {
        const cells: Partial<Record<ColName, string>> = {}
        for (const col of EXPECTED_COLS) cells[col] = idx(col) >= 0 ? (r[idx(col)] ?? '') : ''
        return resolveImportRow(cells, { accounts, categories, rules, defaultRates })
      })
  }, [step, rawRows, headers, colMap, rateInputs, accounts, categories, rules])

  // Non-AUD currencies in the file, so the user can supply a rate for each
  const foreignCurrencies = useMemo(
    () => [...new Set(preview.map(r => r.currency).filter(c => c !== 'AUD'))].sort(),
    [preview],
  )

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
      fx_rate: r.fx_rate,
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
              Columns: Date, Description, Amount, Currency, FX rate, Owner, Account, Category, Notes
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Dates as YYYY-MM-DD or DD/MM/YYYY. Non-AUD amounts are converted to AUD using the FX rate.
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
                  <label htmlFor={`${uid}${col}`} className={lbl}>{col.replace('_', ' ')} {REQUIRED_COLS.includes(col) ? '*' : ''}</label>
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
            onClick={() => setStep('preview')}
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

          {foreignCurrencies.length > 0 && (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-3">
              <p className="text-xs text-gray-400">
                Exchange rate to AUD (used for rows without their own FX rate column)
              </p>
              {foreignCurrencies.map(cur => (
                <div key={cur} className="flex items-center gap-3">
                  <label htmlFor={`${uid}rate-${cur}`} className="text-sm text-white w-28 flex-shrink-0">
                    1 {cur} = AUD
                  </label>
                  <input
                    id={`${uid}rate-${cur}`}
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    min="0"
                    value={rateInputs[cur] ?? ''}
                    onChange={e => setRateInputs(m => ({ ...m, [cur]: e.target.value }))}
                    placeholder="e.g. 1.65"
                    className={input}
                  />
                  {latestRates[cur] && (
                    <span className="text-[10px] text-gray-500 flex-shrink-0">saved {latestRates[cur].date}</span>
                  )}
                </div>
              ))}
            </div>
          )}

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
                  <span className={`text-sm tabular-nums font-medium text-right ${r.aud_amount_cents < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {fmtAUD(r.aud_amount_cents, { signed: true, full: true })}
                    {r.currency !== 'AUD' && (
                      <span className="block text-[10px] text-gray-500 font-normal">
                        {(r.amount_cents / 100).toFixed(2)} {r.currency} × {r.fx_rate}
                      </span>
                    )}
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
