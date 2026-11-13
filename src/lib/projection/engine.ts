// Monthly projection engine. Pure, deterministic, integer cents.
//
// Each month, in this order (so any number can be traced to a row):
//   1. Growth on opening balances: savings interest, investment / super /
//      property growth, loan interest (an offset account reduces the loan
//      balance interest is charged on, and earns nothing itself).
//   2. Pay: each gross salary → tax engine → take-home into the sweep account;
//      employer super (less 15% contributions tax) into that person's super.
//      Net incomes from Settings are used only for people with no gross salary.
//   3. Everyday spending baseline out of the sweep account.
//   4. Planned cashflows (one-offs, recurring, EUR items at the FX rate).
//   5. Loan repayments from the sweep account.
//   6. Life events: a house purchase draws the upfront cash from the deposit
//      accounts and creates the home (asset) and the mortgage (debt).
//   7. Optional "extra saving" (the goal back-solver's lever).
//
// Indexation steps once a year on 1 July (salaries by wage growth, spending
// and inflation-indexed items by inflation). Returns compound monthly.
// Planning model, not advice: every rate is an editable assumption.

import { annualTakeHome, type TaxBreakdown } from '../tax/takeHome'
import { fyOf, fyStartYear, type FyKey } from '../tax/config'
import { addMonthsKey, monthDiff, monthEnd, monthStart, occurrencesInMonth, OCCURRENCES_PER_YEAR } from './schedule'
import type {
  Assumptions, CashflowSummary, Indexation, MonthTotals, ProjAccount, Projection,
  ProjectionInput, ProjectionMonth, TraceEntry,
} from './types'

export const CASH_TYPES: ReadonlySet<string> = new Set(['bank', 'savings', 'offset', 'cash', 'wedding'])
export const INVEST_TYPES: ReadonlySet<string> = new Set(['investment', 'other_asset'])
export const LOAN_TYPES: ReadonlySet<string> = new Set(['mortgage', 'loan'])
export const REVOLVING_TYPES: ReadonlySet<string> = new Set(['credit_card', 'other_liability'])

export const UNALLOCATED_ID = 'cash:unallocated'

/** r/12 nominal for savings (how banks quote), compound monthly for returns. */
function monthlyCompound(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1
}

/** Principal-and-interest repayment per month. */
export function annuityPayment(principalCents: number, annualRatePct: number, months: number): number {
  if (principalCents <= 0) return 0
  if (months <= 1) return principalCents
  const r = annualRatePct / 100 / 12
  if (r === 0) return Math.round(principalCents / months)
  return Math.round(principalCents * r / (1 - Math.pow(1 + r, -months)))
}

export function indexFactor(ix: Indexation, customPct: number | null, fyIndex: number, a: Assumptions): number {
  const rate = ix === 'inflation' ? a.inflation_pct : ix === 'wages' ? a.wage_growth_pct : ix === 'custom' ? (customPct ?? 0) : 0
  return Math.pow(1 + rate / 100, Math.max(0, fyIndex))
}

const fmt = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString('en-AU')}`

function emptySummary(): CashflowSummary {
  return {
    grossPayCents: 0, taxCents: 0, takeHomeCents: 0, otherIncomeCents: 0, superInCents: 0, spendingCents: 0,
    plannedOutCents: 0, loanRepaymentCents: 0, loanInterestCents: 0, interestCents: 0, investmentGrowthCents: 0,
    superGrowthCents: 0, propertyGrowthCents: 0, eventCostsCents: 0, extraCents: 0, netCashCents: 0,
  }
}

export function runProjection(input: ProjectionInput): Projection {
  const a = input.assumptions
  const warnings: string[] = []
  const warnOnce = (() => { const seen = new Set<string>(); return (w: string) => { if (!seen.has(w)) { seen.add(w); warnings.push(w) } } })()
  const excludedKinds = new Set(input.excludeEventKinds ?? [])
  const excludedEventIds = new Set(input.events.filter(e => excludedKinds.has(e.kind)).map(e => e.id))

  // ── Account state ───────────────────────────────────────────────────────────
  const accounts: ProjAccount[] = input.accounts.map(x => ({ ...x }))
  const byId = new Map(accounts.map(x => [x.id, x]))
  const bal = new Map(accounts.map(x => [x.id, Math.round(x.balanceCents)]))
  const addAccount = (acc: ProjAccount) => { accounts.push(acc); byId.set(acc.id, acc); bal.set(acc.id, acc.balanceCents) }
  const synthetic = (id: string, name: string, type: ProjAccount['type'], owner = 'joint'): ProjAccount => ({
    id, name, type, owner, isLiquid: CASH_TYPES.has(type), currency: 'AUD', balanceCents: 0, balanceAsOf: null,
    interestRatePct: null, expectedReturnPct: null, feePct: null, annualFeeCents: null, loan: null, synthetic: true,
  })

  let sweepId = input.sweepAccountId && byId.has(input.sweepAccountId) ? input.sweepAccountId : null
  if (!sweepId) {
    addAccount(synthetic(UNALLOCATED_ID, 'Unallocated cash', 'cash'))
    sweepId = UNALLOCATED_ID
    warnOnce('No everyday account to collect savings in, so surplus goes to "Unallocated cash".')
  }
  const sweep = sweepId
  const depositIds = [...new Set([sweep, ...input.depositAccountIds.filter(id => byId.has(id))])]

  const superAccountFor = (personKey: string): string => {
    const found = accounts.find(x => x.type === 'super' && x.owner === personKey)
    if (found) return found.id
    const name = input.people.find(p => p.key === personKey)?.name ?? personKey
    const acc = synthetic(`super:${personKey}`, `${name} super (no account set up)`, 'super', personKey)
    addAccount(acc)
    warnOnce(`${name} has no super account, so their employer super goes into a placeholder.`)
    return acc.id
  }

  const offsetToLoan = new Map<string, string>()
  for (const x of accounts) if (x.loan?.offsetAccountId) offsetToLoan.set(x.loan.offsetAccountId, x.id)

  const growthRatePct = (x: ProjAccount): number => {
    if (CASH_TYPES.has(x.type)) return offsetToLoan.has(x.id) ? 0 : (x.interestRatePct ?? a.cash_return_pct)
    if (INVEST_TYPES.has(x.type)) return (x.expectedReturnPct ?? a.investment_return_pct) - (x.feePct ?? 0)
    if (x.type === 'super') return (x.expectedReturnPct ?? a.super_return_pct) - (x.feePct ?? 0)
    if (x.type === 'property') return x.expectedReturnPct ?? a.house_price_growth_pct
    if (LOAN_TYPES.has(x.type)) return x.interestRatePct ?? a.mortgage_rate_pct
    return 0
  }

  const totals = (): MonthTotals => {
    const t: MonthTotals = { netWorthCents: 0, liquidCents: 0, superCents: 0, investmentsCents: 0, propertyCents: 0, debtCents: 0, depositPotCents: 0 }
    for (const x of accounts) {
      const b = bal.get(x.id) ?? 0
      t.netWorthCents += b
      if (CASH_TYPES.has(x.type) || x.type === 'credit_card') t.liquidCents += b
      if (x.type === 'super') t.superCents += b
      if (INVEST_TYPES.has(x.type)) t.investmentsCents += b
      if (x.type === 'property') t.propertyCents += b
      if (LOAN_TYPES.has(x.type) || REVOLVING_TYPES.has(x.type)) t.debtCents += b
    }
    for (const id of depositIds) t.depositPotCents += bal.get(id) ?? 0
    return t
  }

  // ── Income setup ────────────────────────────────────────────────────────────
  const peopleWithSalary = new Set(input.salaries.map(s => s.personKey))
  const startFyYear = fyStartYear(fyOf(monthStart(input.startMonth)))
  const taxCache = new Map<string, TaxBreakdown>()
  const extrapolated = new Set<FyKey>()
  const household = input.people.length >= 2
  let rentStopBaseCents = 0

  const opening = { ...totals(), balances: Object.fromEntries(bal) }
  const months: ProjectionMonth[] = []

  for (let i = 0; i < input.months; i++) {
    const mk = addMonthsKey(input.startMonth, i)
    const from = monthStart(mk)
    const to = monthEnd(mk)
    const fy = fyOf(from)
    const fyIdx = fyStartYear(fy) - startFyYear
    const inflF = indexFactor('inflation', null, fyIdx, a)
    const trace: TraceEntry[] = []
    const cf = emptySummary()
    const move = (accountId: string, cents: number, e: Omit<TraceEntry, 'cents' | 'accountId'>) => {
      bal.set(accountId, (bal.get(accountId) ?? 0) + cents)
      trace.push({ ...e, cents, accountId })
    }
    const nameOf = (id: string) => byId.get(id)?.name ?? id

    // 1. Growth on opening balances ───────────────────────────────────────────
    for (const x of [...accounts]) {
      const b = bal.get(x.id) ?? 0
      const ratePct = growthRatePct(x)
      if (CASH_TYPES.has(x.type)) {
        if (b > 0 && ratePct !== 0) {
          const c = Math.round(b * ratePct / 100 / 12)
          if (c) { move(x.id, c, { kind: 'interest', label: `Interest: ${x.name}`, nwCents: c, detail: `${ratePct}% p.a.` }); cf.interestCents += c }
        }
      } else if (INVEST_TYPES.has(x.type) || x.type === 'super' || x.type === 'property') {
        if (b > 0 && ratePct !== 0) {
          const c = Math.round(b * monthlyCompound(ratePct))
          if (c) {
            move(x.id, c, { kind: 'growth', label: `${x.type === 'property' ? 'Value change' : 'Return'}: ${x.name}`, nwCents: c, detail: `${ratePct}% p.a.` })
            if (x.type === 'super') cf.superGrowthCents += c
            else if (x.type === 'property') cf.propertyGrowthCents += c
            else cf.investmentGrowthCents += c
          }
        }
        if (x.type === 'super' && x.annualFeeCents && b > 0) {
          const fee = Math.round(x.annualFeeCents / 12)
          move(x.id, -fee, { kind: 'fees', label: `Admin fee: ${x.name}`, nwCents: -fee })
          cf.superGrowthCents -= fee
        }
      } else if (LOAN_TYPES.has(x.type) && b < 0) {
        let offset = 0
        for (const [offId, loanId] of offsetToLoan) if (loanId === x.id) offset += Math.max(0, bal.get(offId) ?? 0)
        const c = Math.round(Math.max(0, -b - offset) * ratePct / 100 / 12)
        if (c) {
          move(x.id, -c, { kind: 'loan', label: `Interest: ${x.name}`, nwCents: -c, detail: `${ratePct}% p.a.${offset ? `, ${fmt(offset)} offset` : ''}` })
          cf.loanInterestCents += c
        }
      }
    }

    // 2. Pay ───────────────────────────────────────────────────────────────────
    // Leave: a person on leave this month is paid `payPct` of their salary
    // (tax worked out as if that were their pay for the whole year: an approximation).
    const payShare = new Map<string, { pct: number; name: string }>()
    for (const e of input.events) {
      if (!e.leave || e.status !== 'planned' || excludedEventIds.has(e.id)) continue
      if (e.date > to || e.leave.endDate < from) continue
      const cur = payShare.get(e.leave.personKey)
      if (!cur || e.leave.payPct < cur.pct) payShare.set(e.leave.personKey, { pct: e.leave.payPct, name: e.name })
    }
    const grossByPerson = new Map<string, { gross: number; ids: string[] }>()
    for (const s of input.salaries) {
      if (s.startDate > to || (s.endDate && s.endDate < from)) continue
      const share = payShare.get(s.personKey)?.pct ?? 100
      const gross = Math.round(s.grossAnnualCents * indexFactor(s.indexation, s.indexationPct, fyIdx, a) * share / 100)
      const cur = grossByPerson.get(s.personKey) ?? { gross: 0, ids: [] }
      grossByPerson.set(s.personKey, { gross: cur.gross + gross, ids: [...cur.ids, s.id] })
    }
    let combined = 0
    for (const v of grossByPerson.values()) combined += v.gross
    for (const [personKey, { gross, ids }] of grossByPerson) {
      const p = input.people.find(x => x.key === personKey)
      const name = p?.name ?? personKey
      const key = `${fy}|${personKey}|${gross}|${household ? combined : 0}`
      let tb = taxCache.get(key)
      if (!tb) {
        tb = annualTakeHome({
          grossCents: gross,
          hasPrivateHospital: p?.hasPrivateHospital ?? true,
          hasHecs: p?.hasHecs ?? false,
          family: household ? { combinedIncomeCents: combined } : undefined,
        }, fy)
        taxCache.set(key, tb)
      }
      if (tb.extrapolated) extrapolated.add(fy)
      const mGross = Math.round(gross / 12)
      const mTax = Math.round(tb.totalTaxCents / 12)
      const mHelp = Math.round(tb.helpCents / 12)
      const net = mGross - mTax - mHelp
      const ref = { table: 'salary' as const, id: ids[0] }
      const leave = payShare.get(personKey)
      trace.push({ kind: 'income', label: `${name}: gross pay`, cents: mGross, nwCents: 0, memo: true, ref, detail: `${fmt(gross)}/yr in ${fy}${leave ? ` (${leave.name}: ${leave.pct}% of pay)` : ''}` })
      trace.push({
        kind: 'tax', label: `${name}: tax${mHelp ? ' + HELP' : ''}`, cents: -(mTax + mHelp), nwCents: 0, memo: true, ref,
        detail: `Income tax ${fmt(tb.incomeTaxCents - tb.litoCents)}, Medicare ${fmt(tb.medicareLevyCents)}` +
          (tb.mlsCents ? `, MLS ${fmt(tb.mlsCents)}` : '') + (tb.helpCents ? `, HELP ${fmt(tb.helpCents)}` : '') + ` per year${tb.extrapolated ? ' (tax settings carried forward)' : ''}`,
      })
      move(sweep, net, { kind: 'income', label: `${name}: take-home pay`, nwCents: net, ref })
      const superNet = Math.round(tb.superNetCents / 12)
      if (superNet) move(superAccountFor(personKey), superNet, { kind: 'super', label: `${name}: employer super`, nwCents: superNet, ref, detail: `${fmt(tb.sgCents)}/yr SG less 15% contributions tax` })
      cf.grossPayCents += mGross; cf.taxCents += mTax + mHelp; cf.takeHomeCents += net; cf.superInCents += superNet
    }
    for (const ni of input.netIncomes) {
      if (ni.personKey && peopleWithSalary.has(ni.personKey)) continue
      const share = ni.personKey ? (payShare.get(ni.personKey)?.pct ?? 100) : 100
      const c = Math.round(ni.monthlyNetCents * indexFactor('wages', null, fyIdx, a) * share / 100)
      if (!c) continue
      move(sweep, c, { kind: 'income', label: `${ni.label}: take-home pay`, nwCents: c, ref: { table: 'net_income', id: ni.personKey ?? 'household' }, detail: ni.source })
      cf.takeHomeCents += c
    }

    // 3. Everyday spending ─────────────────────────────────────────────────────
    const baseSpend = Math.round(input.spending.totalMonthlyCents * inflF)
    const rentStop = Math.min(baseSpend, Math.round(rentStopBaseCents * inflF))
    const spend = baseSpend - rentStop
    if (spend) {
      const top = input.spending.lines.filter(l => l.basis !== 'excluded' && l.monthlyCents > 0)
        .sort((x, y) => y.monthlyCents - x.monthlyCents).slice(0, 3)
        .map(l => `${l.name} ${fmt(l.monthlyCents * inflF)}`).join(', ')
      move(sweep, -spend, {
        kind: 'spending', label: 'Everyday spending', nwCents: -spend, ref: { table: 'spending', id: 'baseline' },
        detail: `${top}${rentStop ? `; rent of ${fmt(rentStop)} stopped after the purchase` : ''}${fyIdx > 0 ? `; +${a.inflation_pct}% inflation a year` : ''}`,
      })
      cf.spendingCents += spend
    }

    // 4. Planned cashflows ─────────────────────────────────────────────────────
    for (const c of input.cashflows) {
      if (c.eventId && excludedEventIds.has(c.eventId)) continue
      let n = occurrencesInMonth(c, mk).length
      // One-offs still to come this month (before the first projected month) land in month one.
      if (i === 0 && c.frequency === 'once' && c.startDate < from && c.startDate >= input.today) n = 1
      if (!n) continue
      const rate = c.currency === 'AUD' ? 1 : input.fx[c.currency]
      if (!rate) { warnOnce(`No ${c.currency} exchange rate, so "${c.description}" is left out.`); continue }
      const native = Math.abs(c.amountCents) * indexFactor(c.indexation, c.indexationPct, fyIdx, a) * n
      const aud = Math.round(native * rate)
      if (!aud) continue
      const label = `${c.description}${n > 1 ? ` ×${n}` : ''}`
      const detail = c.currency !== 'AUD' ? `${(native / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })} ${c.currency} at ${rate} AUD` : undefined
      const ref = { table: 'planned_cashflows' as const, id: c.id }
      const own = (id: string | null) => (id && byId.has(id) ? id : sweep)
      if (c.kind === 'income') {
        move(own(c.accountId), aud, { kind: 'planned', label, nwCents: aud, ref, detail })
        cf.otherIncomeCents += aud
      } else if (c.kind === 'expense') {
        move(own(c.accountId), -aud, { kind: 'planned', label, nwCents: -aud, ref, detail })
        cf.plannedOutCents += aud
      } else if (c.kind === 'transfer') {
        if (!c.toAccountId || !byId.has(c.toAccountId)) { warnOnce(`"${c.description}" moves money to an account that no longer exists, so it's left out.`); continue }
        move(own(c.accountId), -aud, { kind: 'transfer', label: `${label} → ${nameOf(c.toAccountId)}`, nwCents: 0, ref, detail })
        move(c.toAccountId, aud, { kind: 'transfer', label: `${label} ← ${nameOf(own(c.accountId))}`, nwCents: 0, ref, detail, inLeg: true })
      } else {
        const target = c.accountId && byId.get(c.accountId)?.type === 'super' ? c.accountId : c.personKey ? superAccountFor(c.personKey) : null
        if (!target) { warnOnce(`"${c.description}" has no person or super account, so it's left out.`); continue }
        move(sweep, -aud, { kind: 'super', label: `${label} → ${nameOf(target)}`, nwCents: 0, ref, detail: 'After-tax contribution (no contributions tax modelled)' })
        move(target, aud, { kind: 'super', label, nwCents: 0, ref, inLeg: true })
      }
    }

    // 5. Loan repayments ───────────────────────────────────────────────────────
    for (const x of [...accounts]) {
      if (!LOAN_TYPES.has(x.type) || !x.loan) continue
      const owed = -(bal.get(x.id) ?? 0)
      if (owed <= 0) continue
      const interestThisMonth = -trace.filter(t => t.accountId === x.id && t.kind === 'loan' && t.nwCents < 0).reduce((s, t) => s + t.cents, 0)
      let due: number
      if (x.loan.interestOnly) due = interestThisMonth
      else if (x.loan.repaymentCents && x.loan.repaymentFreq) due = Math.round(x.loan.repaymentCents * OCCURRENCES_PER_YEAR[x.loan.repaymentFreq] / 12)
      else if (x.loan.startDate && x.loan.termMonths) {
        // Re-amortise the opening balance over the months left; the last one clears it.
        const left = x.loan.termMonths - monthDiff(x.loan.startDate.slice(0, 7), mk)
        due = left <= 1 ? owed : annuityPayment(owed - interestThisMonth, growthRatePct(x), left)
      } else { warnOnce(`${x.name} has no repayment details, so only its interest is paid (balance held).`); due = interestThisMonth }
      const pay = Math.min(due, owed)
      if (pay <= 0) continue
      move(sweep, -pay, { kind: 'loan', label: `Repayment: ${x.name}`, nwCents: 0, ref: { table: 'accounts', id: x.id } })
      move(x.id, pay, { kind: 'loan', label: `Repayment from ${nameOf(sweep)}`, nwCents: 0, ref: { table: 'accounts', id: x.id }, inLeg: true })
      cf.loanRepaymentCents += pay
    }

    // 6. Life events ───────────────────────────────────────────────────────────
    const pins: ProjectionMonth['pins'] = []
    for (const e of input.events) {
      if (e.status === 'cancelled' || excludedEventIds.has(e.id) || e.date.slice(0, 7) !== mk) continue
      pins.push({ id: e.id, name: e.name, kind: e.kind })
      if (e.kind !== 'house_purchase' || e.status !== 'planned' || !e.house) continue
      const h = e.house
      const ref = { table: 'life_events' as const, id: e.id }
      const costs = Math.min(h.costsCents, h.upfrontCents)
      const loan = Math.max(0, h.priceCents - (h.upfrontCents - costs))
      // Draw the upfront cash: sweep first, then other deposit cash accounts, then deposit investments.
      const cashFirst = (x: string) => (x === sweep ? 0 : CASH_TYPES.has(byId.get(x)!.type) ? 1 : 2)
      const order = [...depositIds].sort((p, q) => cashFirst(p) - cashFirst(q) || (bal.get(q) ?? 0) - (bal.get(p) ?? 0))
      let need = h.upfrontCents
      for (const id of order) {
        const take = Math.min(need, Math.max(0, bal.get(id) ?? 0))
        if (take > 0) { move(id, -take, { kind: 'event', label: `House deposit + costs from ${nameOf(id)}`, nwCents: -take, ref }); need -= take }
        if (need <= 0) break
      }
      if (need > 0) {
        move(sweep, -need, { kind: 'event', label: 'House deposit + costs (shortfall)', nwCents: -need, ref })
        warnOnce(`Short ${fmt(need)} of the ${fmt(h.upfrontCents)} needed for "${e.name}" in ${mk}.`)
      }
      const homeId = `house:${e.id}`
      const loanId = `mortgage:${e.id}`
      addAccount(synthetic(homeId, 'Home', 'property'))
      move(homeId, h.priceCents, {
        kind: 'event', label: 'Home bought', nwCents: h.priceCents, ref,
        detail: `Price ${fmt(h.priceCents)}; ${costs < 0 ? `grant exceeds duty + fees by ${fmt(costs)}` : `duty, fees, LMI less grants ${fmt(costs)}`}${h.costsSource === 'entered' ? ' (your figure)' : ' (WA calculator)'}`,
      })
      if (loan > 0) {
        // Repayment fixed at drawdown (as banks set it); an offset or extra repayments shorten the loan.
        const scheduled = annuityPayment(loan, a.mortgage_rate_pct, h.loanTermMonths)
        const offsetId = h.offsetAccountId && byId.has(h.offsetAccountId) && CASH_TYPES.has(byId.get(h.offsetAccountId)!.type) ? h.offsetAccountId : null
        if (h.offsetAccountId && !offsetId) warnOnce('The offset account chosen for the mortgage no longer exists, so no offset is modelled.')
        addAccount({
          ...synthetic(loanId, 'Mortgage', 'mortgage'),
          loan: {
            repaymentCents: scheduled + h.extraRepaymentMonthlyCents, repaymentFreq: 'monthly',
            startDate: monthStart(addMonthsKey(mk, 1)), termMonths: h.loanTermMonths, interestOnly: false, offsetAccountId: offsetId,
          },
        })
        if (offsetId) offsetToLoan.set(offsetId, loanId)
        move(loanId, -loan, {
          kind: 'event', label: 'Mortgage drawn', nwCents: -loan, ref,
          detail: `${a.mortgage_rate_pct}% over ${Math.round(h.loanTermMonths / 12)} years, ${fmt(scheduled)}/mo` +
            (h.extraRepaymentMonthlyCents ? ` + ${fmt(h.extraRepaymentMonthlyCents)} extra` : '') + (offsetId ? `; offset: ${nameOf(offsetId)}` : ''),
        })
      }
      rentStopBaseCents += h.rentMonthlyCents
      cf.eventCostsCents += costs
    }

    // 7. Extra saving (what-if) ────────────────────────────────────────────────
    const extra = Math.round(input.extraMonthlyCents ?? 0)
    if (extra) {
      move(sweep, extra, { kind: 'extra', label: 'Extra saving (what-if)', nwCents: extra })
      cf.extraCents = extra
    }

    cf.netCashCents = cf.takeHomeCents + cf.otherIncomeCents - cf.spendingCents - cf.plannedOutCents - cf.loanRepaymentCents + cf.extraCents
    months.push({ month: mk, fy, ...totals(), balances: Object.fromEntries(bal), cashflow: cf, trace, pins })
  }

  const lowest = months.reduce<ProjectionMonth | null>((lo, m) => (!lo || m.liquidCents < lo.liquidCents ? m : lo), null)
  if (lowest && lowest.liquidCents < 0) warnOnce(`Cash goes below zero (lowest ${fmt(lowest.liquidCents)} in ${lowest.month}).`)

  return {
    startMonth: input.startMonth,
    opening,
    months,
    accounts,
    sweepAccountId: sweep,
    depositAccountIds: depositIds,
    warnings,
    extrapolatedFys: [...extrapolated].sort(),
  }
}
