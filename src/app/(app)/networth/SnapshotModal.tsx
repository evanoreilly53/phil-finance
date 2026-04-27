'use client'

import { useState, useMemo, useId } from 'react'
import Modal from '@/components/Modal'
import { saveSnapshots } from './actions'
import type { Account, Snapshot } from './NetWorthView'

type Props = {
  accounts: Account[]
  latestSnapshots: Record<string, Snapshot>
  onClose: () => void
}

export default function SnapshotModal({ accounts, latestSnapshots, onClose }: Props) {
  const uid = useId()
  const perthToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date())
  const [date, setDate]       = useState(perthToday)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState('')

  const latestSnapDate = useMemo(() => {
    const dates = Object.values(latestSnapshots).map(s => s.date).filter(Boolean)
    return dates.length > 0 ? dates.sort().at(-1)! : null
  }, [latestSnapshots])

  function initialBalances() {
    return Object.fromEntries(
      accounts.map(a => {
        const snap = latestSnapshots[a.id]
        if (!snap || snap.date !== latestSnapDate || perthToday !== latestSnapDate) return [a.id, '']
        return [a.id, (snap.balance_cents / 100).toFixed(2)]
      }),
    )
  }
  function initialFxRates() {
    return Object.fromEntries(
      accounts.filter(a => a.currency !== 'AUD').map(a => {
        const snap = latestSnapshots[a.id]
        if (!snap || snap.date !== latestSnapDate || perthToday !== latestSnapDate) return [a.id, '']
        return [a.id, snap.fx_rate != null ? String(snap.fx_rate) : '']
      }),
    )
  }

  const [balances, setBalances] = useState<Record<string, string>>(initialBalances)
  const [fxRates, setFxRates]   = useState<Record<string, string>>(initialFxRates)

  function handleDateChange(newDate: string) {
    setDate(newDate)
    if (newDate !== latestSnapDate) {
      setBalances(Object.fromEntries(accounts.map(a => [a.id, ''])))
      setFxRates(Object.fromEntries(accounts.filter(a => a.currency !== 'AUD').map(a => [a.id, ''])))
    } else {
      setBalances(initialBalances())
      setFxRates(initialFxRates())
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const rows = accounts
      .filter(a => balances[a.id] !== '' && balances[a.id] !== undefined)
      .map(a => {
        const native = parseFloat(balances[a.id])
        if (isNaN(native)) return null
        if (a.currency !== 'AUD') {
          const rate = parseFloat(fxRates[a.id] || '1')
          if (isNaN(rate) || rate <= 0) return null
          return { date, account_id: a.id, balance_cents: Math.round(native * 100), currency: a.currency, aud_balance_cents: Math.round(native * rate * 100), fx_rate: rate }
        }
        return { date, account_id: a.id, balance_cents: Math.round(native * 100), currency: 'AUD', aud_balance_cents: Math.round(native * 100), fx_rate: 1 }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    if (rows.length === 0) { setError('Enter at least one balance'); setSubmitting(false); return }

    const result = await saveSnapshots(rows)
    setSubmitting(false)
    if (result.error) setError(result.error)
    else onClose()
  }

  const input = 'bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full'
  const lbl   = 'text-xs text-gray-400'

  const grouped: Record<string, Account[]> = {}
  for (const a of accounts) {
    if (!grouped[a.type]) grouped[a.type] = []
    grouped[a.type].push(a)
  }
  const typeOrder = ['bank', 'savings', 'investment', 'super']
  const typeLabel: Record<string, string> = { bank: 'Bank', savings: 'Savings', investment: 'Investments', super: 'Super' }

  return (
    <Modal title="Update Balances" onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-5 pb-8 space-y-5 pt-4">
        <div>
          <label htmlFor={`${uid}date`} className={`${lbl} block mb-1.5`}>Snapshot Date</label>
          <input id={`${uid}date`} type="date" value={date} onChange={e => handleDateChange(e.target.value)} className={input} />
        </div>

        {typeOrder.filter(t => grouped[t]?.length).map(type => (
          <div key={type}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2" aria-hidden="true">{typeLabel[type]}</p>
            <div className="space-y-3">
              {grouped[type].map(acc => (
                <div key={acc.id}>
                  <label htmlFor={`${uid}bal-${acc.id}`} className={`${lbl} flex justify-between mb-1.5`}>
                    <span>{acc.name}</span>
                    {acc.currency !== 'AUD' && <span className="text-gray-500">{acc.currency} — native amount + rate</span>}
                  </label>
                  <div className={acc.currency !== 'AUD' ? 'grid grid-cols-2 gap-2' : ''}>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" aria-hidden="true">
                        {acc.currency !== 'AUD' ? acc.currency.slice(0, 1) : '$'}
                      </span>
                      <input id={`${uid}bal-${acc.id}`} type="number" step="0.01" placeholder="0.00"
                        value={balances[acc.id] ?? ''} onChange={e => setBalances(b => ({ ...b, [acc.id]: e.target.value }))}
                        aria-label={`${acc.name} balance${acc.currency !== 'AUD' ? ` in ${acc.currency}` : ''}`}
                        className={`${input} pl-7`} inputMode="decimal" />
                    </div>
                    {acc.currency !== 'AUD' && (
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" aria-hidden="true">→AUD</span>
                        <input type="number" min="0.0001" step="0.0001" placeholder="1.6500"
                          value={fxRates[acc.id] ?? ''} onChange={e => setFxRates(r => ({ ...r, [acc.id]: e.target.value }))}
                          aria-label={`${acc.name} exchange rate to AUD`}
                          className={`${input} pl-10 text-xs`} inputMode="decimal" />
                      </div>
                    )}
                  </div>
                  {acc.currency !== 'AUD' && balances[acc.id] && fxRates[acc.id] && (
                    <p className="text-xs text-gray-500 mt-1" aria-live="polite">
                      ≈ ${(parseFloat(balances[acc.id] || '0') * parseFloat(fxRates[acc.id] || '1')).toLocaleString('en-AU', { maximumFractionDigits: 0 })} AUD
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 text-sm transition-colors">
          {submitting ? 'Saving…' : 'Save Snapshot'}
        </button>
      </form>
    </Modal>
  )
}
