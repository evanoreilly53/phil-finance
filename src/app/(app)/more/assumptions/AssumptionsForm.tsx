'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { fmtAUD, monthLabel } from '@/lib/format'
import { annualTakeHome, perPeriod } from '@/lib/tax/takeHome'
import type { FyKey } from '@/lib/tax/config'
import { saveAssumptions, saveHouse, savePersonFlags, saveSalary } from './actions'
import { purchase } from '@/lib/house/purchase'
import type { PropertyKind } from '@/lib/house/duty'

export type AssumptionField = { key: string; label: string; unit: 'pct' | 'rate' | 'aud'; min: number; max: number; value: number; isDefault: boolean }
export type HouseForm = {
  eventId: string; name: string; month: string
  priceCents: number; upfrontCents: number; costsCents: number | null; firstHome: boolean; propertyKind: PropertyKind; useScheme: boolean
  rentMonthlyCents: number; loanTermMonths: number; depositAccountIds: string[]
}
export type PersonForm = { key: string; name: string; hasPrivateHospital: boolean; hasHecs: boolean; grossAnnualCents: number; startDate: string }

type Props = {
  scenarioName: string | null
  fields: AssumptionField[]
  house: HouseForm | null
  oldGoal: { name: string; date: string } | null
  accounts: { id: string; name: string; type: string; currency: string }[]
  people: PersonForm[]
  fy: FyKey
}

const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-indigo-500'
const dollars = (cents: number | null) => (cents === null ? '' : String(Math.round(cents / 100)))
const toCents = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-gray-400">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

function SaveRow({ pending, error, saved, onSave, label = 'Save' }: { pending: boolean; error: string | null; saved: boolean; onSave: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onSave} disabled={pending}
        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm text-white font-medium">
        {pending ? 'Saving…' : label}
      </button>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {saved && !error && !pending && <p className="text-xs text-green-400">Saved. Projections updated.</p>}
    </div>
  )
}

function useSave() {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const run = (fn: () => Promise<{ error?: string }>) => {
    setSaved(false); setError(null)
    start(async () => { const r = await fn(); if (r.error) setError(r.error); else setSaved(true) })
  }
  return { pending, error, saved, run, setError }
}

export default function AssumptionsForm({ scenarioName, fields, house, oldGoal, accounts, people, fy }: Props) {
  return (
    <div className="space-y-4 pb-4">
      <p className="text-xs text-gray-400 px-1">
        {scenarioName ? <>Editing <span className="text-gray-200">{scenarioName}</span>. </> : 'No baseline scenario yet (run migration 0008). '}
        These are your own estimates for modelling, not advice. Every projection, goal date and the Home check-in use them.
      </p>
      {house && <HouseSection house={house} oldGoal={oldGoal} accounts={accounts} />}
      <Section title="Pay" hint={`Gross salary per year, excluding employer super. Take-home is worked out with ${fy} tax rates (resident brackets, Medicare levy, and MLS / HELP when switched on).`}>
        {people.length === 0 && <p className="text-sm text-gray-400">No people set up yet (run migration 0008).</p>}
        {people.map(p => <PersonBlock key={p.key} person={p} partnerGross={people.filter(x => x.key !== p.key).reduce((s, x) => s + x.grossAnnualCents, 0)} fy={fy} />)}
      </Section>
      <RatesSection fields={fields} disabled={!scenarioName} />
    </div>
  )
}

function HouseSection({ house, oldGoal, accounts }: { house: HouseForm; oldGoal: Props['oldGoal']; accounts: Props['accounts'] }) {
  const [month, setMonth] = useState(house.month)
  const [price, setPrice] = useState(dollars(house.priceCents))
  const [upfront, setUpfront] = useState(dollars(house.upfrontCents))
  const [costs, setCosts] = useState(dollars(house.costsCents))
  const [rent, setRent] = useState(dollars(house.rentMonthlyCents || null))
  const [termYears, setTermYears] = useState(String(Math.round(house.loanTermMonths / 12)))
  const [deposit, setDeposit] = useState(new Set(house.depositAccountIds))
  const s = useSave()

  const priceC = toCents(price) ?? 0
  // Blank costs = the WA calculator (duty, Landgate fees, settlement, inspection, LMI, less FHOG), contract date = the month.
  const placeholder = purchase({ priceCents: priceC, cashCents: toCents(upfront) ?? 0, firstHome: house.firstHome, kind: house.propertyKind, contractDate: `${month || house.month}-01`, useScheme: house.useScheme }).costsCents
  const loan = Math.max(0, priceC - ((toCents(upfront) ?? 0) - (toCents(costs) ?? placeholder)))
  const goalMonth = oldGoal?.date.slice(0, 7)

  function save() {
    const vals = { priceCents: toCents(price), upfrontCents: toCents(upfront), costsCents: toCents(costs), rent: toCents(rent) ?? 0, term: Number(termYears) }
    if ([vals.priceCents, vals.upfrontCents, vals.costsCents, vals.rent].some(v => Number.isNaN(v))) { s.setError('Use plain dollar amounts'); return }
    s.run(() => saveHouse(house.eventId, month, {
      priceCents: vals.priceCents ?? 0, upfrontCents: vals.upfrontCents ?? 0, costsCents: vals.costsCents,
      rentMonthlyCents: vals.rent, loanTermMonths: Math.round(vals.term * 12), depositAccountIds: [...deposit],
    }))
  }

  return (
    <Section title={house.name} hint="The headline goal: upfront cash (deposit + duty + costs) by this month. Property type, first-home status and the 5% scheme are set on the House tab.">
      {goalMonth && goalMonth !== month && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          Not confirmed yet: the plan says {monthLabel(month, { month: 'short', year: 'numeric' })}, but the goal &ldquo;{oldGoal!.name}&rdquo; says {monthLabel(goalMonth, { month: 'short', year: 'numeric' })}. Set the month you want here.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field id="h-month" label="Buy in"><input id="h-month" type="month" className={input} value={month} onChange={e => setMonth(e.target.value)} /></Field>
        <Field id="h-price" label="Price ($)"><input id="h-price" inputMode="decimal" className={input} value={price} onChange={e => setPrice(e.target.value)} /></Field>
        <Field id="h-upfront" label="Upfront cash ($)" hint="Deposit + duty + costs"><input id="h-upfront" inputMode="decimal" className={input} value={upfront} onChange={e => setUpfront(e.target.value)} /></Field>
        <Field id="h-costs" label="Of which duty + costs ($)" hint={costs === '' ? `Blank = WA calculator: ${fmtAUD(placeholder)}` : 'Clear to use the WA calculator'}>
          <input id="h-costs" inputMode="decimal" className={input} placeholder={dollars(placeholder)} value={costs} onChange={e => setCosts(e.target.value)} />
        </Field>
        <Field id="h-rent" label="Rent that stops ($/mo)" hint="Leave blank if rent isn't in your spending"><input id="h-rent" inputMode="decimal" className={input} value={rent} onChange={e => setRent(e.target.value)} /></Field>
        <Field id="h-term" label="Loan term (years)"><input id="h-term" inputMode="numeric" className={input} value={termYears} onChange={e => setTermYears(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-gray-400">Mortgage at purchase: <span className="text-white tabular-nums">{fmtAUD(loan)}</span> at the mortgage rate below.</p>
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-gray-400 mb-1">Counts toward the deposit</legend>
        {accounts.map(a => (
          <label key={a.id} className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" className="accent-indigo-500" checked={deposit.has(a.id)}
              onChange={e => setDeposit(prev => { const n = new Set(prev); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n })} />
            {a.name}<span className="text-[11px] text-gray-500">{a.type}{a.currency !== 'AUD' ? ` · ${a.currency}` : ''}</span>
          </label>
        ))}
        <p className="text-[11px] text-gray-500">The account your savings collect in always counts. Super is never included.</p>
      </fieldset>
      <SaveRow {...s} onSave={save} label="Save house plan" />
    </Section>
  )
}

function PersonBlock({ person, partnerGross, fy }: { person: PersonForm; partnerGross: number; fy: FyKey }) {
  const [gross, setGross] = useState(dollars(person.grossAnnualCents || null))
  const [start, setStart] = useState(person.startDate)
  const [cover, setCover] = useState(person.hasPrivateHospital)
  const [hecs, setHecs] = useState(person.hasHecs)
  const s = useSave()
  const grossC = toCents(gross) ?? 0

  const preview = useMemo(() => {
    if (!Number.isFinite(grossC) || grossC <= 0) return null
    return annualTakeHome({ grossCents: grossC, hasPrivateHospital: cover, hasHecs: hecs, family: { combinedIncomeCents: grossC + partnerGross } }, fy)
  }, [grossC, cover, hecs, partnerGross, fy])

  function save() {
    if (Number.isNaN(grossC)) { s.setError('Use a plain dollar amount'); return }
    s.run(async () => {
      const r1 = await savePersonFlags(person.key, { hasPrivateHospital: cover, hasHecs: hecs })
      if (r1.error) return r1
      return saveSalary(person.key, grossC, start)
    })
  }

  return (
    <div className="border-t border-gray-800 pt-4 first:border-0 first:pt-0 space-y-3">
      <p className="text-sm text-white font-medium">{person.name}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`g-${person.key}`} label="Gross salary ($/yr)"><input id={`g-${person.key}`} inputMode="decimal" className={input} value={gross} onChange={e => setGross(e.target.value)} placeholder="e.g. 105000" /></Field>
        <Field id={`s-${person.key}`} label="From"><input id={`s-${person.key}`} type="date" className={input} value={start} onChange={e => setStart(e.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-gray-200">
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={cover} onChange={e => setCover(e.target.checked)} /> Private hospital cover</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={hecs} onChange={e => setHecs(e.target.checked)} /> HECS/HELP debt</label>
      </div>
      {preview && (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          {(['monthly', 'fortnightly', 'weekly'] as const).map(f => (
            <div key={f} className="bg-gray-800/60 rounded-lg px-2.5 py-2">
              <dt className="text-gray-500 capitalize">{f} take-home</dt>
              <dd className="text-white tabular-nums font-medium">{fmtAUD(perPeriod(preview, f).netCents)}</dd>
            </div>
          ))}
          <div className="col-span-3 text-[11px] text-gray-500 leading-relaxed">
            {fmtAUD(preview.netCents)}/yr after {fmtAUD(preview.incomeTaxCents - preview.litoCents)} tax, {fmtAUD(preview.medicareLevyCents)} Medicare
            {preview.mlsCents ? `, ${fmtAUD(preview.mlsCents)} MLS` : ''}{preview.helpCents ? `, ${fmtAUD(preview.helpCents)} HELP` : ''}.
            {' '}Employer super {fmtAUD(preview.sgCents)}/yr; concessional cap room {fmtAUD(preview.capHeadroomCents)}.
            {' '}Payslips use ATO withholding tables, so each pay can differ by a few dollars.
          </div>
        </dl>
      )}
      <SaveRow {...s} onSave={save} label={`Save ${person.name}`} />
    </div>
  )
}

function RatesSection({ fields, disabled }: { fields: AssumptionField[]; disabled: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map(f => [f.key, String(f.value)])))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function save() {
    setSaved(false); setError(null); setFieldErrors({})
    start(async () => {
      const r = await saveAssumptions(values)
      if (r.error) { setError(r.error); setFieldErrors(r.fieldErrors ?? {}) } else setSaved(true)
    })
  }

  return (
    <Section title="Rates" hint="Yearly rates. Pay and prices step up each 1 July; returns compound monthly. An account's own rate (Track › Accounts) overrides these.">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(f => (
          <Field key={f.key} id={`a-${f.key}`} label={`${f.label}${f.unit === 'pct' ? ' (%)' : f.unit === 'aud' ? ' ($/mo)' : ''}`} hint={fieldErrors[f.key] ?? (f.isDefault ? 'App default' : undefined)}>
            <input id={`a-${f.key}`} inputMode="decimal" disabled={disabled} aria-invalid={!!fieldErrors[f.key]}
              className={`${input} ${fieldErrors[f.key] ? 'border-red-500' : ''}`}
              value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <SaveRow pending={pending} error={error} saved={saved} onSave={save} label="Save rates" />
    </Section>
  )
}
