import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '@/lib/supabase/server'
import { OCCURRENCES_PER_YEAR } from '@/lib/projection/schedule'
import { perthToday } from '@/lib/import/dates'
import { fmtAUD } from '@/lib/format'
import { CONCESSIONAL_SOURCE, plannedSacrificeInFy, superCapLines, type ConcessionalRow } from '@/lib/superCap'
import { resolvePersonAssumptions } from '@/lib/assumptions'
import { addMonths, perthMonthKey } from '@/lib/format'
import { FHSS } from '@/lib/house/rules'
import ConcessionalForm, { ConcessionalEntry } from './ConcessionalForm'

async function load() {
  try {
    const supabase = await createClient()
    const today = perthToday()
    const [{ data: people, error: pErr }, { data: salaries, error: sErr }, { data: rows, error: rErr }, { data: scenarios }, { data: assumptionRows }] = await Promise.all([
      supabase.from('people').select('key, display_name, has_private_hospital, has_hecs').order('sort_order'),
      supabase.from('planned_cashflows').select('person_key, amount_cents, frequency, start_date, end_date')
        .eq('kind', 'income').eq('is_gross', true).eq('status', 'planned').is('scenario_id', null),
      supabase.from('planned_cashflows').select('id, person_key, amount_cents, frequency, start_date, end_date, status, description')
        .eq('kind', 'super_contribution').eq('source_table', CONCESSIONAL_SOURCE).neq('status', 'cancelled'),
      supabase.from('scenarios').select('id, is_baseline, parent_scenario_id').eq('is_baseline', true),
      supabase.from('assumptions').select('scenario_id, key, value').like('key', 'salary_sacrifice__%'),
    ])
    if (pErr || sErr || rErr) return null
    const grossOf = (key: string) => (salaries ?? []).filter(r => r.person_key === key && r.frequency !== 'once' && r.start_date <= today && (!r.end_date || r.end_date >= today))
      .reduce((s, r) => s + Math.abs(r.amount_cents) * OCCURRENCES_PER_YEAR[r.frequency as Exclude<typeof r.frequency, 'once'>], 0)
    // Phase 5: the baseline's salary sacrifice (Assumptions) for the rest of this FY uses the same cap.
    const baseline = (scenarios ?? [])[0]
    const perPerson = resolvePersonAssumptions(baseline?.id ?? '', scenarios ?? [], assumptionRows ?? [], (people ?? []).map(p => p.key))
    const firstMonth = addMonths(perthMonthKey(), 1)
    const planned = (key: string) => plannedSacrificeInFy(Math.round((perPerson[key]?.salary_sacrifice.value ?? 0) * 100), firstMonth, today)
    const lines = superCapLines((people ?? []).map(p => ({ key: p.key, name: p.display_name, grossCents: grossOf(p.key), hasPrivateHospital: p.has_private_hospital, hasHecs: p.has_hecs, plannedSacrificeCents: planned(p.key) })), (rows ?? []) as ConcessionalRow[], today)
    return { today, lines, people: (people ?? []).map(p => ({ key: p.key, name: p.display_name })) }
  } catch {
    return null
  }
}

/** Per person: SG from gross salary, voluntary concessional contributions entered, cap room left this FY. */
export default async function SuperCapCard() {
  const data = await load()
  if (!data || !data.lines.length) return null
  const { lines, today, people } = data
  return (
    <section id="super" className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4 scroll-mt-20">
      <div className="flex items-center justify-between">
        <h2 className="text-xs text-gray-400 uppercase tracking-wider">Super cap · {lines[0].fy}</h2>
        <span className="text-[11px] text-gray-500">{lines[0].daysLeft} days to 30 June</span>
      </div>
      <ul className="space-y-4">
        {lines.map(l => (
          <li key={l.personKey} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-white">{l.name}</span>
              <span className={`text-sm tabular-nums ${l.headroomCents < 0 ? 'text-red-400' : 'text-green-300'}`}>
                {l.headroomCents < 0 ? `${fmtAUD(-l.headroomCents)} over the cap` : `${fmtAUD(l.headroomCents)} room left`}
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden flex" role="progressbar" aria-label={`${l.name} concessional cap used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, l.usedPct)}>
              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, l.capCents ? l.sgCents / l.capCents * 100 : 0)}%` }} />
              <div className="h-full bg-teal-400" style={{ width: `${Math.min(100, l.capCents ? l.voluntaryCents / l.capCents * 100 : 0)}%` }} />
              <div className="h-full bg-sky-300" style={{ width: `${Math.min(100, l.capCents ? l.plannedCents / l.capCents * 100 : 0)}%` }} />
            </div>
            <p className="text-[11px] text-gray-500">
              {l.grossCents > 0 ? <>Employer super <span className="text-indigo-300">{fmtAUD(l.sgCents)}</span> on {fmtAUD(l.grossCents)} gross</> : 'No gross salary in Assumptions, so no employer super counted'}
              {' · '}voluntary <span className="text-teal-300">{fmtAUD(l.voluntaryCents)}</span>
              {l.plannedCents > 0 && <> · salary sacrifice in the plan <span className="text-sky-300">{fmtAUD(l.plannedCents)}</span> (rest of this FY, from Assumptions)</>}
              {' · '}cap {fmtAUD(l.capCents)}
            </p>
            {l.entries.length > 0 && (
              <ul className="text-[11px] text-gray-400 space-y-0.5">
                {l.entries.map(e => <ConcessionalEntry key={e.id} entry={e} />)}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <ConcessionalForm people={people} today={today} />
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Concessional = employer super + salary sacrifice + personal contributions you claim as a deduction, taxed 15% in the fund.
        FHSS contributions made this way use the same room (up to {fmtAUD(FHSS.perFyCapCents)} a year counts for FHSS): see <Link href={'/house#fhss' as Route} className="text-indigo-400">House › FHSS</Link>.
        Carry-forward of unused cap from earlier years (allowed under $500k total super) isn&apos;t counted. Estimates, not advice.
      </p>
    </section>
  )
}
