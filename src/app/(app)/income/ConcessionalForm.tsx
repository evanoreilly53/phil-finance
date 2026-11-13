'use client'

import { useState, useTransition } from 'react'
import { fmtAUD, fmtDate } from '@/lib/format'
import { addConcessional, removeConcessional } from './actions'

type Freq = 'once' | 'monthly' | 'fortnightly'

export function ConcessionalEntry({ entry }: { entry: { id: string; description: string; dates: string[]; cents: number; status: string } }) {
  const [pending, start] = useTransition()
  const [gone, setGone] = useState(false)
  if (gone) return null
  return (
    <li className="flex justify-between gap-3">
      <span className="truncate">{entry.description} · {entry.dates.length > 1 ? `${entry.dates.length}× from ${fmtDate(entry.dates[0], { day: 'numeric', month: 'short' })}` : fmtDate(entry.dates[0], { day: 'numeric', month: 'short' })}{entry.status === 'planned' ? ' (planned)' : ''}</span>
      <span className="flex items-center gap-2 tabular-nums">
        {fmtAUD(entry.cents)}
        <button type="button" disabled={pending} aria-label={`Remove ${entry.description}`} className="text-gray-500 hover:text-red-400"
          onClick={() => start(async () => { const r = await removeConcessional(entry.id); if (!r.error) setGone(true) })}>×</button>
      </span>
    </li>
  )
}

function ConcessionalForm({ people, today }: { people: { key: string; name: string }[]; today: string }) {
  const [open, setOpen] = useState(false)
  const [person, setPerson] = useState(people[0]?.key ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [freq, setFreq] = useState<Freq>('once')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-indigo-400">+ Add a voluntary concessional contribution</button>

  function save() {
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { setError('Enter an amount'); return }
    setError(null)
    start(async () => {
      const r = await addConcessional({ personKey: person, amountCents: cents, date, frequency: freq })
      if (r.error) setError(r.error)
      else { setAmount(''); setOpen(false) }
    })
  }

  const cls = 'bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'
  return (
    <div className="space-y-2 border-t border-gray-800 pt-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-500">Who<select value={person} onChange={e => setPerson(e.target.value)} className={`${cls} w-full mt-0.5`}>{people.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
        <label className="text-[11px] text-gray-500">Amount ($)<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={`${cls} w-full mt-0.5`} /></label>
        <label className="text-[11px] text-gray-500">{freq === 'once' ? 'Date' : 'First date'}<input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${cls} w-full mt-0.5`} /></label>
        <label className="text-[11px] text-gray-500">How often<select value={freq} onChange={e => setFreq(e.target.value as Freq)} className={`${cls} w-full mt-0.5`}>
          <option value="once">Once</option><option value="fortnightly">Each fortnight (salary sacrifice)</option><option value="monthly">Each month</option>
        </select></label>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{pending ? 'Saving…' : 'Add'}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300">Cancel</button>
      </div>
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}

export default ConcessionalForm
