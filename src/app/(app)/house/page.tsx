import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Route } from 'next'
import { House, Scale, BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { fmtAUD, fmtCompact, monthLabel } from '@/lib/format'
import { fetchPlanData, buildPlan, depositGoal } from '@/lib/projection/load'
import { runProjection, CASH_TYPES, LOAN_TYPES, REVOLVING_TYPES } from '@/lib/projection/engine'
import { addMonthsKey, monthDiff, OCCURRENCES_PER_YEAR } from '@/lib/projection/schedule'
import { borrowingPower } from '@/lib/house/borrowing'
import { fhssTimeline } from '@/lib/house/fhss'
import { allHouseSources, SERVICEABILITY } from '@/lib/house/rules'
import { fyOf } from '@/lib/tax/config'
import { Caveat, Panel, ScenarioChips, Stat } from '@/components/planUi'
import PriceExplorer from './PriceExplorer'
import FhssCard from './FhssCard'
import MortgageCard from './MortgageCard'
import BoughtToggle from './BoughtToggle'
import HomeLoanCard from '@/components/HomeLoanCard'
import { homeLoanStatus, isLoanMode } from '@/lib/house/homeLoan'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>
const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })

export default async function HousePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const sid = typeof params.s === 'string' ? params.s : null
  const supabase = await createClient()
  const data = await fetchPlanData(supabase)
  const plan = buildPlan(data, { scenarioId: sid, months: 60 })
  const scenarioLabel = !plan.scenario || plan.scenario.isBaseline ? 'the baseline' : `“${plan.scenario.name}”`
  const scenarioId = plan.scenario?.id ?? null
  const h = plan.house
  const today = plan.input.today

  const chips = plan.scenarios.length > 1 && (
    <ScenarioChips scenarios={plan.scenarios} currentId={scenarioId} basePath="/house" manageHref="/future/scenarios" />
  )

  if (!h) {
    return (
      <div className="space-y-4">
        {chips}
        <Panel title="The plan" icon={<House size={14} />}>
          <p className="text-sm text-gray-400">No house purchase in this plan yet. Add the price, month and upfront cash in <Link href={'/more/assumptions' as Route} className="text-indigo-400">More › Assumptions</Link>.</p>
        </Panel>
      </div>
    )
  }

  const hp = h.house
  const houseMonth = h.date.slice(0, 7)
  const goal = depositGoal(plan)
  const loanCents = Math.max(0, hp.priceCents - (hp.upfrontCents - hp.costsCents))

  // ── Borrowing power inputs ─────────────────────────────────────────────────
  const fy = fyOf(today)
  const grossBy = new Map<string, number>()
  for (const s of plan.salaryRows) {
    if (s.endDate && s.endDate < today) continue
    grossBy.set(s.personKey, (grossBy.get(s.personKey) ?? 0) + s.grossAnnualCents)
  }
  const earners = plan.people.filter(p => (grossBy.get(p.key) ?? 0) > 0)
    .map(p => ({ key: p.key, name: p.name, grossCents: grossBy.get(p.key)!, hasPrivateHospital: p.hasPrivateHospital, hasHecs: p.hasHecs }))
  const living = Math.max(0, plan.input.spending.totalMonthlyCents - hp.rentMonthlyCents)
  const debts = plan.input.accounts.filter(a => LOAN_TYPES.has(a.type) || REVOLVING_TYPES.has(a.type))
  const debtBalance = debts.reduce((s, a) => s + Math.max(0, -a.balanceCents), 0)
  const debtMonthly = debts.reduce((s, a) => {
    if (a.loan?.repaymentCents && a.loan.repaymentFreq) return s + Math.round(a.loan.repaymentCents * OCCURRENCES_PER_YEAR[a.loan.repaymentFreq] / 12)
    if (REVOLVING_TYPES.has(a.type)) return s + Math.round(Math.max(0, -a.balanceCents) * 0.038) // lenders assume ~3.8% of a card balance/limit a month
    return s
  }, 0)
  const rate = plan.input.assumptions.mortgage_rate_pct
  const bp = earners.length ? borrowingPower({
    people: earners, fy, livingMonthlyCents: living, otherDebtMonthlyCents: debtMonthly, otherDebtBalanceCents: debtBalance, ratePct: rate, termMonths: hp.loanTermMonths,
  }) : null
  const fit = bp ? (loanCents <= bp.lowCents ? 'within' : loanCents <= bp.highCents ? 'edge' : 'above') : null

  // ── Mortgage card inputs ───────────────────────────────────────────────────
  const proj = runProjection({ ...plan.input, months: Math.max(plan.input.months, monthDiff(plan.input.startMonth, houseMonth) + 13) })
  const after = proj.months.filter(m => m.month > houseMonth && m.month <= addMonthsKey(houseMonth, 12))
  const surplusAfter = after.length ? Math.round(after.reduce((s, m) => s + m.cashflow.netCashCents, 0) / after.length) : 0
  const cashAccounts = plan.input.accounts.filter(a => CASH_TYPES.has(a.type) && a.currency === 'AUD' && a.type !== 'wedding')
    .map(a => ({ id: a.id, name: a.name, balanceCents: proj.months.find(m => m.month === houseMonth)?.balances[a.id] ?? a.balanceCents }))

  // ── FHSS ───────────────────────────────────────────────────────────────────
  const tl = fhssTimeline(houseMonth, today)

  // ── Home Loan mode (Phase 5) ───────────────────────────────────────────────
  const loanMode = isLoanMode(h, data.thisMonth)
  const loan = loanMode ? homeLoanStatus({ thisMonth: data.thisMonth, accounts: plan.input.accounts, house: { date: h.date, status: h.status, params: hp }, mortgageRatePct: rate }) : null
  const canMark = h.scenarioId === null

  return (
    <div className="space-y-4">
      {chips}

      {loan && (
        <>
          <HomeLoanCard s={loan} full />
          {canMark && (
            <div className="px-1 space-y-1">
              <BoughtToggle eventId={h.id} bought={h.status === 'done'} />
              <p className="text-[11px] text-gray-500">
                {h.status === 'done' ? 'Marked as bought.' : `Showing the loan because ${mon(houseMonth)} has come.`} If you haven&apos;t bought yet, {h.status === 'done' ? 'undo it here' : 'move the month in Assumptions'} and the deposit tools come back.
              </p>
            </div>
          )}
        </>
      )}

      <PurchaseTools collapsed={loanMode}>
      <Panel title="The plan" icon={<House size={14} />} aside={<Link href={'/more/assumptions' as Route} className="text-xs text-indigo-400">Edit →</Link>}>
        <p className="text-white font-semibold">{h.name}{!plan.scenario?.isBaseline && plan.scenario && <span className="text-xs text-indigo-300 font-normal"> · {plan.scenario.name}{h.scenarioId === null ? ' (baseline house)' : ''}</span>}</p>
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Price" value={fmtCompact(hp.priceCents)} hint={mon(houseMonth)} />
          <Stat label="Upfront cash" value={fmtCompact(hp.upfrontCents)} hint={`${fmtCompact(hp.costsCents)} costs${hp.costsSource === 'entered' ? ' (your figure)' : ''}`} />
          <Stat label="Loan" value={fmtCompact(loanCents)} hint={`${((loanCents / hp.priceCents) * 100).toFixed(1)}% LVR`} />
        </dl>
        {goal && (
          <p className="text-xs text-gray-400">
            Deposit: {goal.projectedMonth === 'now' ? 'already there' : goal.projectedMonth ? <>projected <span className="text-white">{mon(goal.projectedMonth)}</span></> : 'not reached in the projection'}
            {goal.extraMonthlyCents ? ` · +${fmtAUD(goal.extraMonthlyCents)}/mo closes the gap` : ''}
            {goal.fhss ? ` · includes ~${fmtAUD(goal.fhss.netCents)} FHSS release in ${mon(goal.fhss.month)}` : ''}
          </p>
        )}
        {!loanMode && canMark && <BoughtToggle eventId={h.id} bought={false} />}
      </Panel>

      <PriceExplorer
        scenarioId={scenarioId} scenarioLabel={scenarioLabel} month={houseMonth}
        priceCents={hp.priceCents} cashCents={hp.upfrontCents} firstHome={hp.firstHome} kind={hp.propertyKind} useScheme={hp.useScheme}
        projectedPotCents={goal?.valueAtByMonth ?? null}
      />

      <Panel title="Borrowing power (indicative)" icon={<Scale size={14} />} id="borrowing">
        {!bp ? (
          <p className="text-sm text-gray-400">Add each person&apos;s gross salary in <Link href={'/more/assumptions' as Route} className="text-indigo-400">More › Assumptions</Link> to estimate this.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Indicative range" value={`${fmtCompact(bp.lowCents)}–${fmtCompact(bp.highCents)}`} hint={`tested at ${bp.assessedRatePct}% (${rate}% + ${SERVICEABILITY.bufferPctPoints}% buffer)`} />
              <Stat label="6× income" value={fmtCompact(bp.dti6Cents)} hint={`${fmtCompact(bp.grossAnnualCents)} gross a year`} />
            </dl>
            <p className={`text-sm ${fit === 'within' ? 'text-green-300' : fit === 'edge' ? 'text-amber-300' : 'text-red-300'}`}>
              This plan&apos;s {fmtCompact(loanCents)} loan is {fit === 'within' ? 'inside' : fit === 'edge' ? 'near the top of' : 'above'} this range.
              {loanCents > bp.dti6Cents && ` It's over 6× your income: banks can only write a limited share (${SERVICEABILITY.dtiShareLimitPct}%) of new loans like that.`}
            </p>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>After-tax income {fmtAUD(bp.netMonthlyCents)}/mo ({earners.map(e => `${e.name} ${fmtCompact(e.grossCents)}`).join(', ')}, {fy} tax tables)</li>
              <li>Living costs {fmtAUD(bp.expensesMonthlyCents)}/mo: {bp.expenseBasis === 'actual'
                ? `your recent spending${hp.rentMonthlyCents ? `, less ${fmtAUD(hp.rentMonthlyCents)} rent that stops` : ''}`
                : `a HEM-style floor (higher than your recorded ${fmtAUD(living)})`}. The low end of the range adds 15%.</li>
              {debtMonthly > 0 && <li>Other debt repayments {fmtAUD(debtMonthly)}/mo</li>}
              <li>Leaves {fmtAUD(bp.surplusMonthlyCents)}/mo. At {rate}% the top of the range would cost about {fmtAUD(bp.repaymentAtHighCents)}/mo.</li>
            </ul>
            <Caveat>An indicative serviceability test, not a lender assessment or pre-approval. Each lender shades income, uses its own expense benchmark and buffer, and can differ by $100k or more. A broker or lender can tell you what you can actually borrow.</Caveat>
          </>
        )}
      </Panel>

      <FhssCard
        people={earners}
        startMonth={plan.input.startMonth}
        releaseMonth={tl.requestBy}
        signMonth={houseMonth}
        fys={tl.fys}
        cashRatePct={plan.input.assumptions.cash_return_pct}
      />
      <p className="text-[11px] text-gray-500 px-1 -mt-2">
        FHSS contributions share the concessional cap with employer super. See what&apos;s left this year in <Link href={'/income#super' as Route} className="text-indigo-400">Track › Income › Super cap</Link>.
        {' '}{plan.fhss.on && plan.input.sacrifice?.length
          ? <>FHSS is <span className="text-gray-300">on</span> in this plan&apos;s projection: {plan.input.sacrifice.map(s => `${plan.people.find(p => p.key === s.personKey)?.name ?? s.personKey} ${fmtAUD(s.annualCents)}/yr`).join(', ')} salary sacrifice, released before {mon(houseMonth)}{goal?.fhss ? ` (about ${fmtAUD(goal.fhss.netCents)} after tax)` : ''}.</>
          : <>FHSS is <span className="text-gray-300">off</span> in the projection{plan.fhss.note ? ` (${plan.fhss.note})` : ''}. Switch it on with a salary sacrifice in <Link href={'/more/assumptions' as Route} className="text-indigo-400">Assumptions</Link>.</>}
      </p>

      <MortgageCard
        scenarioId={scenarioId} scenarioLabel={scenarioLabel}
        loanCents={loanCents} ratePct={rate} termMonths={hp.loanTermMonths}
        cashAccounts={cashAccounts} offsetAccountId={hp.offsetAccountId} extraRepaymentMonthlyCents={hp.extraRepaymentMonthlyCents}
        surplusAfterCents={surplusAfter}
      />
      </PurchaseTools>

      <details className="bg-gray-900 rounded-2xl border border-gray-800 p-5 text-xs">
        <summary className="flex items-center gap-2 text-gray-400 cursor-pointer"><BookOpen size={13} /> Where these numbers come from</summary>
        <ul className="mt-3 space-y-2">
          {allHouseSources(h.date).map(s => (
            <li key={s.item} className="text-gray-300">
              <span className={`inline-block text-[10px] px-1.5 rounded mr-1.5 ${s.status === 'verified' ? 'bg-green-500/15 text-green-300' : s.status === 'estimate' ? 'bg-gray-700 text-gray-300' : 'bg-amber-500/15 text-amber-300'}`}>{s.status}</span>
              {s.item}{s.note && <span className="text-gray-500"> {s.note}</span>}{' '}
              <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-400">source</a> <span className="text-gray-600">· checked {s.checked}</span>
            </li>
          ))}
        </ul>
      </details>
      <Caveat>Planning software, not financial advice. It models your own numbers against published rules and doesn&apos;t recommend lenders or products.</Caveat>
    </div>
  )
}

/** Before the purchase: the tools as they are. In Home Loan mode: tucked away, still reachable. */
function PurchaseTools({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (!collapsed) return <>{children}</>
  return (
    <details className="bg-gray-900/60 rounded-2xl border border-gray-800 p-4">
      <summary className="text-xs text-gray-400 cursor-pointer">Before you bought: the plan, price explorer, borrowing power, FHSS and mortgage planner</summary>
      <div className="space-y-4 mt-4">{children}</div>
    </details>
  )
}
