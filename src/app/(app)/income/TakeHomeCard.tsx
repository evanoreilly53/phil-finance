import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '@/lib/supabase/server'
import { annualTakeHome, perPeriod } from '@/lib/tax/takeHome'
import { fyOf } from '@/lib/tax/config'
import { OCCURRENCES_PER_YEAR } from '@/lib/projection/schedule'
import { perthToday } from '@/lib/import/dates'
import { fmtAUD } from '@/lib/format'

async function load() {
  try {
    const supabase = await createClient()
    const [{ data: people, error: pErr }, { data: rows, error: rErr }] = await Promise.all([
      supabase.from('people').select('key, display_name, has_private_hospital, has_hecs').order('sort_order'),
      supabase.from('planned_cashflows').select('person_key, amount_cents, frequency')
        .eq('kind', 'income').eq('is_gross', true).eq('status', 'planned').is('scenario_id', null),
    ])
    if (pErr || rErr) return null
    const fy = fyOf(perthToday())
    const grossOf = (key: string) => (rows ?? []).filter(r => r.person_key === key && r.frequency !== 'once')
      .reduce((s, r) => s + Math.abs(r.amount_cents) * OCCURRENCES_PER_YEAR[r.frequency as Exclude<typeof r.frequency, 'once'>], 0)
    const combined = (people ?? []).reduce((s, p) => s + grossOf(p.key), 0)
    const lines = (people ?? []).map(p => {
      const gross = grossOf(p.key)
      return { p, b: gross > 0 ? annualTakeHome({ grossCents: gross, hasPrivateHospital: p.has_private_hospital, hasHecs: p.has_hecs, family: { combinedIncomeCents: combined } }, fy) : null }
    })
    return { fy, lines }
  } catch {
    return null
  }
}

/** Gross → tax → super → take-home per person for this FY (from the salaries in Assumptions). */
export default async function TakeHomeCard() {
  const data = await load()
  if (!data) return null
  const { fy, lines } = data
  return (
      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Pay after tax · {fy}</p>
          <Link href={'/more/assumptions' as Route} className="text-xs text-indigo-400">Edit salaries →</Link>
        </div>
        {lines.every(l => !l.b) && <p className="text-sm text-gray-400">Add each person&apos;s gross salary in Assumptions to see their take-home.</p>}
        {lines.filter(l => l.b).map(({ p, b }) => {
          const m = perPeriod(b!, 'monthly')
          return (
            <div key={p.key} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-white">{p.display_name}</span>
                <span className="text-white tabular-nums font-medium">{fmtAUD(m.netCents)}/mo · {fmtAUD(perPeriod(b!, 'fortnightly').netCents)}/fn</span>
              </div>
              <p className="text-[11px] text-gray-500 tabular-nums">
                {fmtAUD(m.grossCents)} gross − {fmtAUD(m.taxCents + m.helpCents)} tax/levies = {fmtAUD(m.netCents)} · plus {fmtAUD(m.superCents)} employer super
              </p>
            </div>
          )
        })}
        <p className="text-[11px] text-gray-500">Estimate from the ATO resident rates for {fy}. Your payslip uses withholding tables and may differ slightly.</p>
      </section>
  )
}
