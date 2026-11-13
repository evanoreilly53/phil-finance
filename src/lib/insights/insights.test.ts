import { describe, it, expect } from 'vitest'
import { goalDrift } from './rules/goal'
import { idleCash } from './rules/cash'
import { fhssWindow, capHeadroom, fyWindow } from './rules/super'
import { subscriptionChanges } from './rules/subscriptions'
import { categorySpike, budgetOverrun, lifestyleCreep } from './rules/spending'
import { priceCliff } from './rules/house'
import { fxFees, eurExposure, isFxFee } from './rules/fx'
import { staleData, uncategorised } from './rules/hygiene'
import { rankInsights, hiddenBy, dedupe, MAX_SHOWN } from './rank'
import { attachDepositDays, depositHitDay, depositDaysLabel, withEffect } from './goalImpact'
import { runInsights, candidateInsights } from './index'
import { runProjection } from '../projection/engine'
import { baseInput, account, spending, $ } from '../projection/fixtures'
import { addMonths } from '../format'
import type { Insight, InsightContext, InsightTx, InsightStateRow } from './types'
import type { Subscription } from '../subscriptions/detect'

const TODAY = '2026-11-13'
const THIS = '2026-11'

const CATS: InsightContext['categories'] = [
  { id: 'eat', name: 'Eating Out', parent_id: null, kind: 'discretionary' },
  { id: 'cafe', name: 'Cafes', parent_id: 'eat', kind: 'discretionary' },
  { id: 'groc', name: 'Groceries', parent_id: null, kind: 'essential' },
  { id: 'sal', name: 'Salary', parent_id: null, kind: 'income' },
  { id: 'xfer', name: 'Transfers', parent_id: null, kind: 'transfer' },
  { id: 'wed', name: 'Wedding', parent_id: null, kind: 'discretionary' },
]

let n = 0
const tx = (date: string, cents: number, category_id: string | null, over: Partial<InsightTx> = {}): InsightTx =>
  ({ id: `x${++n}`, date, description: over.description ?? `SHOP ${n}`, aud_amount_cents: cents, category_id, is_transfer: false, ...over })

function ctx(over: Partial<InsightContext> = {}): InsightContext {
  return {
    today: TODAY, thisMonth: THIS, transactions: [], categories: CATS, budgets: [], accounts: [], cashRatePct: 4.5,
    monthlySpendCents: $(4000), deposit: null, previousCheckin: null, house: null, people: [], fhssReleaseMonth: null,
    subscriptions: [], subscriptionMarks: [], plannedEur: [], eurAudRate: 1.65, ...over,
  }
}

/** Six months of steady eating out ($680) + groceries ($900), then October as given. */
function history(octEat: number, opts: { months?: number } = {}): InsightTx[] {
  const out: InsightTx[] = []
  const months = opts.months ?? 6
  for (let i = months; i >= 1; i--) {
    const m = addMonths('2026-10', -i)
    out.push(tx(`${m}-05`, -$(400), 'eat'), tx(`${m}-18`, -$(280), 'cafe'), tx(`${m}-10`, -$(900), 'groc'), tx(`${m}-15`, $(9000), 'sal'))
  }
  out.push(tx('2026-10-03', -$(octEat / 2), 'eat'), tx('2026-10-20', -$(octEat / 2), 'cafe'), tx('2026-10-10', -$(900), 'groc'))
  return out
}

describe('goal drift', () => {
  const deposit = { eventId: 'h', eventName: 'Buy our first home', projectedMonth: '2028-06', byMonth: '2028-03', monthsLate: 3, extraMonthlyCents: $(610), targetCents: $(250000) }
  it('flags a deposit behind target with the back-solved monthly gap', () => {
    const [i] = goalDrift(ctx({ deposit }))
    expect(i.key).toBe('goal-drift')
    expect(i.title).toMatch(/Jun(e)? 2028/)
    expect(i.title).toContain('3 months after')
    expect(i.detail).toContain('+$610/mo')
    expect(i.impactCents).toBe($(610) * 12)
    expect(i.depositEffect).toEqual({ monthlyCents: $(610) })
  })
  it('flags a slip since last month even when still on time', () => {
    const [i] = goalDrift(ctx({ deposit: { ...deposit, projectedMonth: '2028-02', monthsLate: -1, extraMonthlyCents: 0 }, previousCheckin: { month: '2026-10', depositProjectedMonth: '2027-12' } }))
    expect(i.title).toContain('moved to Feb 2028')
    expect(i.detail).toContain('Dec 2027 (2 months earlier)')
    expect(i.depositEffect).toBeNull()
  })
  it('is quiet when on track and not slipping, already reached, or with no house plan', () => {
    expect(goalDrift(ctx({ deposit: { ...deposit, projectedMonth: '2028-01', monthsLate: -2, extraMonthlyCents: 0 }, previousCheckin: { month: '2026-10', depositProjectedMonth: '2028-01' } }))).toEqual([])
    expect(goalDrift(ctx({ deposit: { ...deposit, projectedMonth: 'now' } }))).toEqual([])
    expect(goalDrift(ctx())).toEqual([])
  })
  it('ignores this month’s own log row (first check-in of the month)', () => {
    const [i] = goalDrift(ctx({ deposit: { ...deposit, projectedMonth: '2028-02', monthsLate: -1, extraMonthlyCents: 0 }, previousCheckin: { month: THIS, depositProjectedMonth: '2027-12' } }) as InsightContext).concat([])
    expect(i).toBeUndefined()
  })
})

describe('idle cash', () => {
  const acct = (over: Partial<InsightContext['accounts'][0]> = {}) => ({ id: 'j', name: 'Joint Everyday', type: 'bank' as const, currency: 'AUD', balanceCents: $(45000), balanceAsOf: '2026-11-10', interestRatePct: 1, dataAsOf: '2026-11-10', ...over })
  it('flags cash above a one-month buffer earning well under the plan rate', () => {
    const [i] = idleCash(ctx({ accounts: [acct()] }))
    // $45k − $4k buffer = $41k at (4.5 − 1)% = $1,435/yr
    expect(i.title).toBe('$41,000 is earning 1% in Joint Everyday')
    expect(i.impactCents).toBe($(1435))
    expect(i.depositEffect).toEqual({ monthlyCents: Math.round($(1435) / 12) })
  })
  it('skips accounts without a recorded rate, near the plan rate, offsets, EUR or small balances', () => {
    expect(idleCash(ctx({ accounts: [acct({ interestRatePct: null })] }))).toEqual([])
    expect(idleCash(ctx({ accounts: [acct({ interestRatePct: 4 })] }))).toEqual([])
    expect(idleCash(ctx({ accounts: [acct({ type: 'offset' })] }))).toEqual([])
    expect(idleCash(ctx({ accounts: [acct({ currency: 'EUR' })] }))).toEqual([])
    expect(idleCash(ctx({ accounts: [acct({ balanceCents: $(8000) })] }))).toEqual([])
  })
  it('keeps no buffer on a savings account', () => {
    const [i] = idleCash(ctx({ accounts: [acct({ type: 'savings', balanceCents: $(10000), name: 'Saver' })] }))
    expect(i.impactCents).toBe($(350))
  })
})

describe('FHSS window and cap headroom', () => {
  const people = [
    { key: 'evan', name: 'Evan', grossCents: $(135000), hasPrivateHospital: true, hasHecs: false, voluntaryConcessionalCents: 0 },
    { key: 'rachel', name: 'Rachel', grossCents: $(107000), hasPrivateHospital: true, hasHecs: false, voluntaryConcessionalCents: 0 },
  ]
  const house = { eventName: 'Home', date: '2028-03-01', priceCents: $(1_000_000), cashCents: $(250_000), firstHome: true, kind: 'established' as const, useScheme: false }
  it('knows the FY window', () => {
    expect(fyWindow('2026-11-13')).toMatchObject({ fy: 'FY2026-27', end: '2027-06-30', monthsLeft: 8 })
    expect(fyWindow('2027-06-02')).toMatchObject({ end: '2027-06-30', monthsLeft: 1 })
    expect(fyWindow('2027-07-01')).toMatchObject({ end: '2028-06-30', monthsLeft: 12 })
  })
  it('shows each person’s FHSS room for this FY with a modelled gain', () => {
    const [i] = fhssWindow(ctx({ people, house, fhssReleaseMonth: '2028-01' }))
    expect(i.key).toBe('fhss-window:FY2026-27')
    expect(i.title).toContain('You each have $15,000')
    expect(i.impactCents).toBeGreaterThan($(2000))
    expect(i.depositEffect).toBeNull()
    expect(i.timeSensitive).toBe(true)
  })
  it('limits room by the concessional cap after SG and voluntary contributions', () => {
    const [i] = fhssWindow(ctx({ people: [{ ...people[0], voluntaryConcessionalCents: $(10000) }], house }))
    // cap 32,500 − SG 16,200 − 10,000 = 6,300
    expect(i.title).toContain('Evan has $6,300')
  })
  it('is quiet without a first-home plan, too early in the FY, or with no room', () => {
    expect(fhssWindow(ctx({ people }))).toEqual([])
    expect(fhssWindow(ctx({ people, house: { ...house, firstHome: false } }))).toEqual([])
    expect(fhssWindow(ctx({ people, house, today: '2026-08-01', thisMonth: '2026-08' }))).toEqual([])
    expect(fhssWindow(ctx({ people: [{ ...people[0], voluntaryConcessionalCents: $(20000) }], house }))).toEqual([])
  })
  it('flags cap headroom only from April to June', () => {
    expect(capHeadroom(ctx({ people }))).toEqual([])
    const out = capHeadroom(ctx({ people, today: '2027-05-01', thisMonth: '2027-05' }))
    expect(out.map(i => i.key)).toEqual(['cap-headroom:evan:FY2026-27', 'cap-headroom:rachel:FY2026-27'])
    expect(out[0].title).toContain('$16,300') // 32,500 − 16,200
  })
})

describe('subscriptions insight', () => {
  const sub = (key: string, over: Partial<Subscription> = {}): Subscription => ({
    key, merchant: key.split('|')[0], merchantKey: key.split('|')[0], description: key, cadence: 'monthly', amountCents: 1500, monthlyCents: 1500, annualCents: 18000,
    firstSeen: '2026-09-02', lastSeen: '2026-11-02', nextDue: '2026-12-02', active: true, isNew: true, priceChange: null, categoryId: null, txIds: ['a', 'b', 'c'], count: 3, ...over,
  })
  it('groups new charges and price rises into one card', () => {
    const [i] = subscriptionChanges(ctx({ subscriptions: [
      sub('Stan|monthly', { amountCents: 1200, monthlyCents: 1200 }),
      sub('Icloud|monthly', { amountCents: 2599, monthlyCents: 2599, firstSeen: '2026-08-20' }),
      sub('Netflix|monthly', { isNew: false, firstSeen: '2025-01-01', amountCents: 2599, priceChange: { fromCents: 2299, toCents: 2599, on: '2026-10-05' } }),
    ] }))
    expect(i.title).toBe('2 new recurring charges since Aug 2026: $38/mo')
    expect(i.detail).toContain('Netflix went up $3.00')
    expect(i.impactCents).toBe((1200 + 2599 + 300) * 12)
    expect(i.key).toBe('subscriptions:Icloud|monthly,Netflix|monthly>2599,Stan|monthly')
  })
  it('leaves out dismissed, tracked (for "new"), ended and old subscriptions', () => {
    const subs = [sub('Stan|monthly'), sub('Gym|monthly'), sub('Old|monthly', { isNew: false }), sub('Ended|monthly', { active: false })]
    const marks = [{ key: 'Stan|monthly', state: 'dismissed' as const, refId: null }, { key: 'Gym|monthly', state: 'tracked' as const, refId: 'p' }]
    expect(subscriptionChanges(ctx({ subscriptions: subs, subscriptionMarks: marks }))).toEqual([])
  })
})

describe('category spike', () => {
  it('flags a category well above its 6-month median, with the transactions behind it', () => {
    const [i] = categorySpike(ctx({ transactions: history(1120) }))
    expect(i.key).toBe('spike:eat')
    expect(i.title).toBe('Eating Out was $1,120 in October, +65% on your 6-month median ($680)')
    expect(i.impactCents).toBe($(440))
    expect(i.depositEffect).toEqual({ oneOffCents: $(440) })
    expect(i.evidence).toHaveLength(2) // child category rolled up
  })
  it('ignores normal months and small rises', () => {
    expect(categorySpike(ctx({ transactions: history(700) }))).toEqual([])
    expect(categorySpike(ctx({ transactions: history(820) }))).toEqual([]) // +$140 < $150
  })
  it('needs three months of history (first month of data)', () => {
    expect(categorySpike(ctx({ transactions: history(1500, { months: 2 }) }))).toEqual([])
    expect(categorySpike(ctx({ transactions: history(1500, { months: 0 }) }))).toEqual([])
  })
  it('excludes transfers and wedding spending', () => {
    const txs = [...history(680), tx('2026-10-12', -$(5000), 'eat', { is_transfer: true }), tx('2026-10-12', -$(5000), 'wed')]
    expect(categorySpike(ctx({ transactions: txs }))).toEqual([])
  })
  it('uses AUD amounts for EUR rows', () => {
    const txs = [...history(680), tx('2026-10-25', -$(800), 'eat', { currency: 'EUR', amount_cents: -$(485) })]
    const [i] = categorySpike(ctx({ transactions: txs }))
    expect(i.title).toContain('$1,480')
    expect(i.evidence[0]).toMatchObject({ currency: 'EUR', nativeCents: -$(485) })
  })
})

describe('budget overrun', () => {
  it('needs a budget (no budget set → nothing)', () => {
    expect(budgetOverrun(ctx({ transactions: history(1500) }))).toEqual([])
  })
  it('flags last month over target by 10% and $50', () => {
    const budgets = [{ category_id: 'eat', monthly_cents: $(700), effective_from: '2026-01-01' }, { category_id: 'groc', monthly_cents: $(880), effective_from: '2026-01-01' }]
    const out = budgetOverrun(ctx({ transactions: history(900), budgets }))
    expect(out.map(i => i.key)).toEqual(['budget-over:eat']) // groceries $20 over: too small
    expect(out[0].impactCents).toBe($(200))
  })
  it('a target set after the month does not apply to it', () => {
    const budgets = [{ category_id: 'eat', monthly_cents: $(500), effective_from: '2026-11-01' }]
    expect(budgetOverrun(ctx({ transactions: history(900), budgets }))).toEqual([])
  })
  it('dedupes with a spike in the same category (bigger impact wins)', () => {
    const budgets = [{ category_id: 'eat', monthly_cents: $(1000), effective_from: '2026-01-01' }]
    const c = ctx({ transactions: history(1300), budgets })
    const all = [...categorySpike(c), ...budgetOverrun(c)]
    expect(all).toHaveLength(2)
    expect(dedupe(all).map(i => i.rule)).toEqual(['category_spike'])
  })
})

describe('lifestyle creep', () => {
  function years(prev: number, recent: number, incPrev: number, incRecent: number) {
    const out: InsightTx[] = []
    for (let i = 0; i < 24; i++) {
      const m = addMonths('2024-11', i)
      const recentYear = i >= 12
      out.push(tx(`${m}-08`, -$(recentYear ? recent : prev), 'eat'), tx(`${m}-15`, $(recentYear ? incRecent : incPrev), 'sal'))
    }
    return out
  }
  it('flags discretionary growth well ahead of income growth', () => {
    const [i] = lifestyleCreep(ctx({ transactions: years(1000, 1200, 10000, 10400) }))
    expect(i.title).toBe('Discretionary spending is up 20% year on year; money in is up 4%')
    expect(i.impactCents).toBe($(14400 - 12480))
  })
  it('needs 24 months of data', () => {
    expect(lifestyleCreep(ctx({ transactions: years(1000, 1500, 10000, 10000).slice(4) }))).toEqual([])
  })
  it('is quiet when spending tracks income', () => {
    expect(lifestyleCreep(ctx({ transactions: years(1000, 1040, 10000, 10400) }))).toEqual([])
  })
})

describe('price cliff', () => {
  const house = { eventName: 'Home', date: '2027-09-01', priceCents: $(820_000), cashCents: $(85_000), firstHome: true, kind: 'established' as const, useScheme: false }
  it('shows the extra upfront cost just above the first-home duty cap', () => {
    const [i] = priceCliff(ctx({ house }))
    expect(i.key).toBe('price-cliff:80000000:82000000')
    expect(i.title).toMatch(/^At \$820,000 upfront costs are about \$[\d,]+ more than at \$800,000$/)
    expect(i.detail).toContain('duty $32,300')
    expect(i.depositEffect).toBeNull()
  })
  it('is quiet far from any threshold (the owner’s $1M plan)', () => {
    expect(priceCliff(ctx({ house: { ...house, priceCents: $(1_000_000), cashCents: $(250_000) } }))).toEqual([])
    expect(priceCliff(ctx({ house: { ...house, priceCents: $(790_000) } }))).toEqual([])
  })
  it('includes the 5% scheme cap when the scheme is planned', () => {
    const out = priceCliff(ctx({ house: { ...house, priceCents: $(870_000), cashCents: $(90_000), useScheme: true } }))
    expect(out.some(i => i.key.startsWith('price-cliff:85000000'))).toBe(true)
  })
})

describe('FX fees and EUR exposure', () => {
  it('recognises fee descriptions', () => {
    expect(isFxFee({ description: 'International Transaction Fee', aud_amount_cents: -312, is_transfer: false })).toBe(true)
    expect(isFxFee({ description: 'FOREIGN CURRENCY CONVERSION FEE', aud_amount_cents: -100, is_transfer: false })).toBe(true)
    expect(isFxFee({ description: 'WOOLWORTHS', aud_amount_cents: -100, is_transfer: false })).toBe(false)
  })
  it('totals the last 12 months of FX fees, mentioning EUR payments', () => {
    const txs = [
      tx('2026-06-01', -$(120), null, { description: 'International Transaction Fee' }),
      tx('2026-09-01', -$(66), null, { description: 'International Transaction Fee' }),
      tx('2025-06-01', -$(500), null, { description: 'International Transaction Fee' }), // too old
      tx('2026-09-01', -$(4000), 'wed', { currency: 'EUR', amount_cents: -$(2400) }),
    ]
    const [i] = fxFees(ctx({ transactions: txs }))
    expect(i.title).toBe('You paid $186 in FX and international fees in the last 12 months')
    expect(i.detail).toContain('1 EUR payment')
    expect(i.depositEffect).toEqual({ monthlyCents: Math.round($(186) / 12) })
  })
  it('flags EUR still to pay as a rate sensitivity', () => {
    const [i] = eurExposure(ctx({ plannedEur: [{ description: 'Venue balance', nativeCents: -$(8000), date: '2027-02-01' }] }))
    expect(i.title).toContain('€8,000')
    expect(i.impactCents).toBe($(660)) // 8000 × 1.65 × 5%
    expect(eurExposure(ctx({ plannedEur: [{ description: 'x', nativeCents: -$(500), date: '2027-02-01' }] }))).toEqual([])
  })
})

describe('hygiene', () => {
  it('lists stale accounts and ignores fresh or empty never-updated ones', () => {
    const accounts = [
      { id: 'a', name: 'AIB', type: 'bank' as const, currency: 'EUR', balanceCents: $(3000), balanceAsOf: '2026-10-02', interestRatePct: null, dataAsOf: '2026-10-02' },
      { id: 'b', name: 'Joint', type: 'bank' as const, currency: 'AUD', balanceCents: $(9000), balanceAsOf: '2026-11-12', interestRatePct: null, dataAsOf: '2026-11-12' },
      { id: 'c', name: 'Unused', type: 'savings' as const, currency: 'AUD', balanceCents: 0, balanceAsOf: null, interestRatePct: null, dataAsOf: null },
    ]
    const [i] = staleData(ctx({ accounts }))
    expect(i.title).toBe("AIB hasn't been updated since 2026-10-02")
    expect(i.key).toBe('stale-data:a@2026-10-02')
  })
  it('flags an uncategorised backlog (transfers and money in excluded)', () => {
    const rows = Array.from({ length: 5 }, (_, k) => tx(`2026-10-0${k + 1}`, -$(100), null))
    expect(uncategorised(ctx({ transactions: rows }))[0].title).toBe('5 transactions from the last 90 days have no category ($500)')
    expect(uncategorised(ctx({ transactions: [...rows.slice(1), tx('2026-10-09', -$(5), null, { is_transfer: true }), tx('2026-10-09', $(5), null)] }))).toEqual([])
  })
})

// ── Ranking, cap and states ──────────────────────────────────────────────────

const ins = (key: string, impact: number, over: Partial<Insight> = {}): Insight => ({
  key, rule: 'category_spike', title: key, detail: '', impactCents: impact, impactLabel: '', depositEffect: null, evidence: [], ...over,
})

describe('ranking, cap and states', () => {
  it('ranks by $ impact and caps at 3', () => {
    const r = rankInsights([ins('a', 100), ins('b', 500), ins('c', 300), ins('d', 50), ins('e', 0, { rule: 'stale_data' })], [], { today: TODAY, thisMonth: THIS })
    expect(MAX_SHOWN).toBe(3)
    expect(r.shown.map(i => i.key)).toEqual(['b', 'c', 'a'])
    expect(r.more.map(i => i.key)).toEqual(['d', 'e'])
  })
  it('puts EOFY items first from April to June only', () => {
    const list = [ins('big', 900), ins('fhss', 100, { rule: 'fhss_window', timeSensitive: true })]
    expect(rankInsights(list, [], { today: '2027-05-01', thisMonth: '2027-05' }).shown[0].key).toBe('fhss')
    expect(rankInsights(list, [], { today: TODAY, thisMonth: THIS }).shown[0].key).toBe('big')
  })
  it('applies Done (this month), Snooze (until a date) and Intentional (for good)', () => {
    const states: InsightStateRow[] = [
      { key: 'a', state: 'done', done_month: THIS, snooze_until: null },
      { key: 'b', state: 'done', done_month: '2026-10', snooze_until: null },
      { key: 'c', state: 'snoozed', done_month: null, snooze_until: '2026-12-13' },
      { key: 'd', state: 'snoozed', done_month: null, snooze_until: '2026-11-13' },
      { key: 'e', state: 'intentional', done_month: null, snooze_until: null },
    ]
    const r = rankInsights(['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => ins(k, 100 - i)), states, { today: TODAY, thisMonth: THIS })
    expect(r.shown.map(i => i.key)).toEqual(['b', 'd', 'f'])
    expect(r.hidden.map(h => [h.insight.key, h.why])).toEqual([['a', 'done'], ['c', 'snoozed'], ['e', 'intentional']])
    expect(r.hidden[1].until).toBe('2026-12-13')
    expect(hiddenBy(undefined, TODAY, THIS)).toBeNull()
  })
  it('a hidden insight frees its slot for the next one', () => {
    const r = rankInsights([ins('a', 400), ins('b', 300), ins('c', 200), ins('d', 100)], [{ key: 'a', state: 'intentional', done_month: null, snooze_until: null }], { today: TODAY, thisMonth: THIS })
    expect(r.shown.map(i => i.key)).toEqual(['b', 'c', 'd'])
  })
})

// ── Days closer to the deposit (through the projection engine) ─────────────

describe('deposit days via the projection engine', () => {
  // $10k now, $5k/month saved (no growth): $50k target reached at the end of month 8 (Jul 2027).
  const input = baseInput({
    accounts: [account('joint', 'bank', 10_000)],
    netIncomes: [{ personKey: null, label: 'Pay', monthlyNetCents: $(6000), source: 'test' }],
    spending: spending(1000), months: 36,
  })
  const target = $(50_000)
  it('interpolates the hit day inside the month', () => {
    const p = runProjection(input)
    const d = depositHitDay(p, target)!
    expect(d).toBeGreaterThan(200)
    expect(d).toBeLessThan(250)
    expect(depositHitDay(p, $(5000))).toBe(0)
    expect(depositHitDay(p, $(10_000_000))).toBeNull()
  })
  it('turns $ a month and one-offs into days sooner', () => {
    const [m, o, none] = attachDepositDays([
      ins('m', 0, { depositEffect: { monthlyCents: $(500) } }),
      ins('o', 0, { depositEffect: { oneOffCents: $(5000) } }),
      ins('n', 0),
    ], input, target)
    // +$500/mo: $40k gap at $5.5k/mo instead of $5k → about 22 days sooner
    expect(m.depositDays).toBeGreaterThanOrEqual(18)
    expect(m.depositDays).toBeLessThanOrEqual(26)
    // +$5k once ≈ one month of saving ≈ 30 days
    expect(o.depositDays).toBeGreaterThanOrEqual(28)
    expect(o.depositDays).toBeLessThanOrEqual(32)
    expect(none.depositDays).toBeNull()
  })
  it('a negative effect means later', () => {
    const [x] = attachDepositDays([ins('x', 0, { depositEffect: { monthlyCents: -$(500) } })], input, target)
    expect(x.depositDays!).toBeLessThan(0)
  })
  it('reports no days without a goal or when already covered', () => {
    expect(attachDepositDays([ins('x', 0, { depositEffect: { monthlyCents: 100 } })], null, null)[0].depositDays).toBeNull()
    const [y] = attachDepositDays([ins('y', 0, { depositEffect: { monthlyCents: 100 } })], input, $(1000))
    expect(y.depositDays).toBeNull()
    expect(y.depositNote).toContain('already')
  })
  it('one-offs land as a planned item in the first projected month', () => {
    const w = withEffect(input, { oneOffCents: $(100) })
    expect(w.cashflows.at(-1)).toMatchObject({ kind: 'income', frequency: 'once', startDate: '2026-12-01' })
  })
  it('labels', () => {
    expect(depositDaysLabel(12)).toBe('deposit ~12 days sooner')
    expect(depositDaysLabel(-1)).toBe('deposit ~1 day later')
    expect(depositDaysLabel(95)).toBe('deposit ~3 months sooner')
    expect(depositDaysLabel(null)).toBeNull()
  })
})

describe('runInsights end to end', () => {
  it('ranks, caps and attaches days; a broken rule does not take it down', () => {
    const input = baseInput({ netIncomes: [{ personKey: null, label: 'Pay', monthlyNetCents: $(6000), source: 't' }], spending: spending(1000), months: 36 })
    const c = ctx({
      transactions: history(1120),
      accounts: [{ id: 'j', name: 'Joint', type: 'bank', currency: 'AUD', balanceCents: $(45000), balanceAsOf: TODAY, interestRatePct: 1, dataAsOf: TODAY }],
      budgets: [{ category_id: 'groc', monthly_cents: $(700), effective_from: '2026-01-01' }],
    })
    const r = runInsights({ ctx: c, states: [], depositInput: input, depositTargetCents: $(80_000) })
    expect(r.shown.map(i => i.rule)).toEqual(['idle_cash', 'category_spike', 'budget_overrun'])
    expect(r.shown.every(i => typeof i.depositDays === 'number' && i.depositDays > 0)).toBe(true)
    expect(r.errors).toEqual([])
    const broken = candidateInsights({ ...c, categories: null as unknown as InsightContext['categories'] })
    expect(broken.errors.length).toBeGreaterThan(0)
  })
  it('first month of data: nothing to say beyond hygiene', () => {
    const c = ctx({ transactions: [tx('2026-11-02', -$(50), 'eat')] })
    expect(candidateInsights(c).insights).toEqual([])
  })
})
