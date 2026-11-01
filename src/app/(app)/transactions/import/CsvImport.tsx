'use client'

import { useState, useId, useMemo, useTransition, useEffect } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { Upload, ChevronRight, Check, AlertTriangle, ArrowLeftRight, Copy, Inbox } from 'lucide-react'
import { commitImport, previewImport, type CommitResult, type PreviewResult, type ImportRow } from './actions'
import type { Category } from '../TransactionList'
import { fmtAUD, fmtDate } from '@/lib/format'
import { parseCsvRecords, parseRate, resolveImportRow, IMPORT_COLS, type ImportCol } from '@/lib/csvImport'
import { looksLikeCommBank, parseCommBank, closingBalance } from '@/lib/import/commbank'
import { toAudCents } from '@/lib/csvImport'
import type { ImportProfile } from '@/lib/supabase/database.types'

type Rule = { pattern: string; category_id: string; owner: string | null; priority: number; is_active: boolean }
export type ImportAccount = { id: string; name: string; type: string; owner: string; currency: string; import_profile: ImportProfile | null; institution: string | null }

const FROM_FILE = '__file__'
const REQUIRED_GENERIC: readonly ImportCol[] = ['date', 'description']

type Step = 'upload' | 'map' | 'preview' | 'done'

type Props = {
  categories: Category[]
  accounts: ImportAccount[]
  rules: Rule[]
  latestRates: Record<string, { rate: number; date: string }>
  initialAccountId: string | null
}

type Draft = ImportRow & { error?: string; line: number }

function strip(d: Draft): ImportRow {
  const { error: _e, line: _l, ...row } = d
  void _e; void _l
  return row
}

export default function CsvImport({ categories, accounts, rules, latestRates, initialAccountId }: Props) {
  const uid = useId()
  const [step, setStep]             = useState<Step>('upload')
  const [accountId, setAccountId]   = useState<string>(initialAccountId ?? accounts.find(a => a.import_profile === 'commbank')?.id ?? FROM_FILE)
  const [fileName, setFileName]     = useState<string | null>(null)
  const [profile, setProfile]       = useState<ImportProfile>('generic')
  const [records, setRecords]       = useState<string[][]>([])
  const [colMap, setColMap]         = useState<Partial<Record<ImportCol, string>>>({})
  const [rateInputs, setRateInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(latestRates).map(([c, r]) => [c, String(r.rate)])),
  )
  const [updateBalance, setUpdateBalance] = useState(true)
  // The server's verdicts, tagged with the exact rows they were computed for
  const [checked, setChecked]       = useState<{ rows: ImportRow[]; result: PreviewResult } | null>(null)
  const [result, setResult]         = useState<CommitResult | null>(null)
  const [fileError, setFileError]   = useState<string | null>(null)
  const [pending, startTransition]  = useTransition()

  const account = accounts.find(a => a.id === accountId) ?? null
  const headers = useMemo(() => records[0] ?? [], [records])
  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  // ── Normalised rows (both profiles end up here) ─────────────────────────────
  const { drafts, closing, parseErrors } = useMemo(() => {
    const defaultRates = Object.fromEntries(Object.entries(rateInputs).map(([c, v]) => [c, parseRate(v)]))
    if (records.length === 0) return { drafts: [] as Draft[], closing: null, parseErrors: [] as { line: number; message: string }[] }

    if (profile === 'commbank') {
      if (!account) return { drafts: [], closing: null, parseErrors: [{ line: 0, message: 'Choose the account this file is from' }] }
      const parsed = parseCommBank(records)
      const currency = account.currency.toUpperCase()
      const out: Draft[] = parsed.rows.map(r => {
        const fx = toAudCents(r.amount_cents, currency, defaultRates[currency] ?? null)
        return {
          line: r.line, account_id: account.id, owner: account.owner as ImportRow['owner'], date: r.date, description: r.description,
          amount_cents: r.amount_cents, currency, aud_amount_cents: fx?.aud_amount_cents ?? 0, fx_rate: fx?.fx_rate ?? 0,
          balance_cents: r.balance_cents, category_id: null, notes: null,
          error: fx ? undefined : `no ${currency}→AUD rate`,
        }
      })
      return { drafts: out, closing: closingBalance(parsed.rows), parseErrors: parsed.errors }
    }

    const idx = (col: ImportCol) => headers.indexOf(colMap[col] ?? '')
    const fixedAccountId = accountId === FROM_FILE ? null : accountId
    const out: Draft[] = records.slice(1).map((r, i) => {
      const cells: Partial<Record<ImportCol, string>> = {}
      for (const col of IMPORT_COLS) cells[col] = idx(col) >= 0 ? (r[idx(col)] ?? '') : ''
      const x = resolveImportRow(cells, { accounts, categories, rules, defaultRates, fixedAccountId })
      return {
        line: i + 2, account_id: x.account_id, owner: x.owner, date: x.date, description: x.description,
        amount_cents: x.amount_cents, currency: x.currency, aud_amount_cents: x.aud_amount_cents, fx_rate: x.fx_rate,
        balance_cents: x.balance_cents, category_id: x.category_id || null, notes: x.notes || null, error: x.error,
      }
    })
    return { drafts: out, closing: null, parseErrors: [] }
  }, [records, profile, account, accountId, headers, colMap, rateInputs, accounts, categories, rules])

  const valid   = useMemo(() => drafts.filter(d => !d.error), [drafts])
  const invalid = drafts.filter(d => d.error)
  const foreignCurrencies = [...new Set(drafts.map(r => r.currency).filter(c => c && c !== 'AUD'))].sort()
  const importRows = useMemo(() => valid.map(strip), [valid])
  const analysis = checked && checked.rows === importRows ? checked.result : null

  // Ask the server (dedupe + transfers need stored data) whenever the rows change
  useEffect(() => {
    if (step !== 'preview' || importRows.length === 0) return
    let cancelled = false
    const t = setTimeout(() => {
      startTransition(async () => {
        const result = await previewImport(importRows)
        if (!cancelled) setChecked({ rows: importRows, result })
      })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [step, importRows])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const recs = parseCsvRecords(String(ev.target?.result ?? ''))
      if (recs.length === 0) { setFileError('That file is empty.'); return }
      setFileName(file.name)
      setRecords(recs)
      if (looksLikeCommBank(recs)) {
        if (accountId === FROM_FILE) { setFileError('This looks like a CommBank export. Choose which account it is from first.'); setRecords([]); return }
        setProfile('commbank')
        setStep('preview')
      } else {
        setProfile('generic')
        const h = recs[0]
        const auto: Partial<Record<ImportCol, string>> = {}
        for (const col of IMPORT_COLS) {
          const key = col.replace(/[^a-z]/g, '')
          const match = h.find(hh => hh.toLowerCase().replace(/[^a-z]/g, '') === key)
            ?? h.find(hh => hh.toLowerCase().replace(/[^a-z]/g, '').includes(key))
          if (match) auto[col] = match
        }
        setColMap(auto)
        setStep('map')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleCommit() {
    if (valid.length === 0) return
    startTransition(async () => {
      const res = await commitImport({
        profile, fileName,
        accountId: accountId === FROM_FILE ? null : accountId,
        rows: importRows,
        closing, updateBalance,
      })
      setResult(res)
      setStep('done')
    })
  }

  const input = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const lbl   = 'block text-xs font-medium text-gray-400 mb-1.5'
  const s     = analysis?.summary
  const missingRequired = profile === 'generic' && (
    REQUIRED_GENERIC.some(c => !colMap[c]) ||
    (!colMap.amount && !colMap.debit && !colMap.credit) ||
    (accountId === FROM_FILE && !colMap.account)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/transactions" className="text-indigo-400 hover:text-indigo-300 text-sm">← Transactions</Link>
        <span className="text-gray-600">/</span>
        <span className="text-sm text-gray-300">Import</span>
      </div>

      <div className="flex items-center gap-1 text-xs">
        {(['upload', 'map', 'preview', 'done'] as Step[]).map((st, i, arr) => (
          <div key={st} className="flex items-center gap-1">
            <span className={`capitalize ${step === st ? 'text-indigo-400 font-medium' : 'text-gray-600'}`}>{i + 1}. {st}</span>
            {i < arr.length - 1 && <ChevronRight size={12} className="text-gray-700" />}
          </div>
        ))}
      </div>

      {step === 'upload' && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-5">
          <div>
            <label htmlFor={`${uid}acct`} className={lbl}>Which account is this file from?</label>
            <select id={`${uid}acct`} value={accountId} onChange={e => setAccountId(e.target.value)} className={input}>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.institution ? ` · ${a.institution}` : ''}{a.currency !== 'AUD' ? ` (${a.currency})` : ''}</option>
              ))}
              <option value={FROM_FILE}>Several accounts (file has an Account column)</option>
            </select>
          </div>
          <div className="text-center space-y-3">
            <Upload size={36} className="text-gray-600 mx-auto" />
            <div className="text-xs text-gray-500 space-y-1">
              <p><span className="text-gray-300 font-medium">CommBank:</span> NetBank → account → Export → CSV. Drop the file in as is.</p>
              <p><span className="text-gray-300 font-medium">Other banks / AIB:</span> any CSV with a header row; you map the columns next. EUR rows are converted to AUD.</p>
              <p>Rows you&apos;ve already imported are skipped automatically.</p>
            </div>
            <label htmlFor={`${uid}file`} className="cursor-pointer inline-block bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
              Choose CSV file
              <input id={`${uid}file`} type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
            </label>
            {fileError && <p role="alert" className="text-sm text-red-400">{fileError}</p>}
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
            <p className="text-sm font-medium text-white">Map your columns ({records.length - 1} rows)</p>
            <p className="text-xs text-gray-500">Use either Amount (signed) or Debit + Credit. Dates as YYYY-MM-DD or DD/MM/YYYY.</p>
            <div className="grid grid-cols-2 gap-3">
              {IMPORT_COLS.filter(c => !(c === 'account' && accountId !== FROM_FILE)).map(col => (
                <div key={col}>
                  <label htmlFor={`${uid}${col}`} className={lbl}>{col.replace('_', ' ')} {REQUIRED_GENERIC.includes(col) ? '*' : ''}</label>
                  <select id={`${uid}${col}`} value={colMap[col] ?? ''} onChange={e => setColMap(m => ({ ...m, [col]: e.target.value }))} className={input}>
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setStep('upload'); setRecords([]) }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl py-3 text-sm">Back</button>
            <button onClick={() => setStep('preview')} disabled={missingRequired}
              className="flex-[2] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm">
              Preview →
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">
              {profile === 'commbank' ? 'CommBank export' : 'CSV'} · {account?.name ?? 'several accounts'} · {drafts.length} rows
            </span>
            <button onClick={() => setStep(profile === 'generic' ? 'map' : 'upload')} className="text-xs text-indigo-400 hover:text-indigo-300">← Back</button>
          </div>

          {foreignCurrencies.length > 0 && (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-3">
              <p className="text-xs text-gray-400">Exchange rate to AUD (rows without their own FX rate column)</p>
              {foreignCurrencies.map(cur => (
                <div key={cur} className="flex items-center gap-3">
                  <label htmlFor={`${uid}rate-${cur}`} className="text-sm text-white w-28 flex-shrink-0">1 {cur} = AUD</label>
                  <input id={`${uid}rate-${cur}`} type="number" inputMode="decimal" step="0.0001" min="0"
                    value={rateInputs[cur] ?? ''} onChange={e => { setRateInputs(m => ({ ...m, [cur]: e.target.value })) }}
                    placeholder="e.g. 1.65" className={input} />
                  {latestRates[cur] && <span className="text-[10px] text-gray-500 flex-shrink-0">ECB {latestRates[cur].date}</span>}
                </div>
              ))}
            </div>
          )}

          {(invalid.length > 0 || parseErrors.length > 0) && (
            <div className="bg-red-900/30 border border-red-800 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
                <AlertTriangle size={14} /> {invalid.length + parseErrors.length} rows can&apos;t be read and will be skipped
              </div>
              {[...parseErrors.map(e => `Line ${e.line}: ${e.message}`), ...invalid.map(r => `Line ${r.line}: ${r.description || '(blank)'} — ${r.error}`)]
                .slice(0, 4).map((m, i) => <p key={i} className="text-xs text-red-300 truncate">{m}</p>)}
            </div>
          )}

          {analysis?.error && <p role="alert" className="text-sm text-red-400">{analysis.error}</p>}

          {s ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="New" value={s.toImport} tone="text-green-400" />
              <Stat label="Already imported" value={s.duplicates} tone="text-gray-400" />
              <Stat label="Transfers" value={s.transfers} tone="text-sky-400" />
              <Stat label="To review" value={s.possibleDuplicates + s.suspectedTransfers + s.uncategorised} tone="text-amber-400" />
            </div>
          ) : (
            <p className="text-xs text-gray-500">{pending ? 'Checking for duplicates and transfers…' : valid.length === 0 ? 'Nothing to import.' : foreignCurrencies.length ? 'Enter the exchange rate to continue.' : ''}</p>
          )}

          {closing && profile === 'commbank' && (
            <label className="flex items-start gap-3 bg-gray-900 rounded-2xl border border-gray-800 p-4 text-sm text-gray-300">
              <input type="checkbox" checked={updateBalance} onChange={e => setUpdateBalance(e.target.checked)} className="mt-0.5 accent-indigo-500" />
              <span>Record the balance from the file: <span className="text-white font-medium">{fmtAUD(closing.balance_cents, { full: true })}</span> on {fmtDate(closing.date)}<span className="block text-xs text-gray-500">Updates net worth and the account&apos;s freshness. Skipped if you already entered a balance that day.</span></span>
            </label>
          )}

          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="divide-y divide-gray-800 max-h-96 overflow-y-auto">
              {valid.slice(0, 100).map((r, i) => {
                const v = analysis?.verdicts?.[i]
                return (
                  <div key={i} className={`px-4 py-2.5 flex items-center gap-3 ${v?.status === 'skip_duplicate' ? 'opacity-40' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{r.description}</p>
                      <p className="text-[11px] text-gray-500 truncate">
                        {fmtDate(r.date, { day: 'numeric', month: 'short' })}
                        {v && <> · <Verdict v={v} catName={catName} /></>}
                      </p>
                    </div>
                    <span className={`text-sm tabular-nums font-medium text-right flex-shrink-0 ${r.aud_amount_cents < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {fmtAUD(r.aud_amount_cents, { signed: true, full: true })}
                      {r.currency !== 'AUD' && <span className="block text-[10px] text-gray-500 font-normal">{(r.amount_cents / 100).toFixed(2)} {r.currency} × {r.fx_rate}</span>}
                    </span>
                  </div>
                )
              })}
              {valid.length > 100 && <div className="px-4 py-3 text-xs text-gray-500">…and {valid.length - 100} more</div>}
            </div>
          </div>

          <button onClick={handleCommit} disabled={pending || !s || s.toImport === 0 && !closing}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-colors text-sm">
            {pending && s ? 'Importing…' : s && s.toImport === 0 ? (closing ? 'Nothing new: just record the balance' : 'Nothing new to import') : `Import ${s?.toImport ?? ''} transaction${s?.toImport === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {step === 'done' && result && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center space-y-4">
          {result.error ? (
            <>
              <AlertTriangle size={40} className="text-red-400 mx-auto" />
              <p className="text-white font-medium">Import failed. Nothing was saved.</p>
              <p className="text-sm text-red-400">{result.error}</p>
            </>
          ) : (
            <>
              <Check size={40} className="text-green-400 mx-auto" />
              <p className="text-white font-medium">{result.imported} transaction{result.imported !== 1 ? 's' : ''} imported</p>
              {result.summary && (
                <p className="text-xs text-gray-400">
                  {result.summary.duplicates} already there · {result.summary.transfers} transfers
                  {result.snapshot ? ' · balance recorded' : ''}
                </p>
              )}
            </>
          )}
          <div className="flex flex-col gap-2 items-center">
            {!result.error && result.summary && (result.summary.possibleDuplicates + result.summary.suspectedTransfers + result.summary.uncategorised) > 0 && (
              <Link href={'/transactions/review' as Route} className="inline-flex items-center gap-2 bg-amber-500/20 text-amber-300 text-sm font-medium px-4 py-2 rounded-xl">
                <Inbox size={14} /> Review {result.summary.possibleDuplicates + result.summary.suspectedTransfers + result.summary.uncategorised} rows
              </Link>
            )}
            <button onClick={() => { setStep('upload'); setRecords([]); setResult(null) }} className="text-sm text-indigo-400 hover:text-indigo-300">Import another file</button>
            <Link href="/transactions" className="text-sm text-gray-400 hover:text-gray-300">View transactions →</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  )
}

function Verdict({ v, catName }: { v: NonNullable<PreviewResult['verdicts']>[number]; catName: Map<string, string> }) {
  if (v.status === 'skip_duplicate') return <span className="inline-flex items-center gap-1"><Copy size={10} /> already imported</span>
  if (v.is_transfer) return <span className="inline-flex items-center gap-1 text-sky-400"><ArrowLeftRight size={10} /> transfer</span>
  if (v.flags.includes('suspected_duplicate')) return <span className="text-amber-400">possible duplicate</span>
  if (v.flags.includes('suspected_transfer')) return <span className="text-amber-400">transfer?</span>
  if (!v.category_id) return <span className="text-amber-400">needs category</span>
  return <span>{catName.get(v.category_id) ?? 'categorised'}</span>
}
