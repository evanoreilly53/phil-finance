import { describe, it, expect } from 'vitest'
import { detectSubscriptions, merchantKey, priceChangeOf, type DetectTx } from './detect'
import { upcomingBills, billCalendar, visibleSubscriptions } from './bills'
import { addDays } from '../import/dates'
import { advanceDate } from '../plannedItems'

const TODAY = '2026-11-13'

// Deterministic jitter (no Math.random in tests).
function lcg(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }

let n = 0
function series(p: { desc: string; start: string; count: number; cents: number | ((i: number) => number); step: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'; jitterDays?: number; jitterCents?: number; seed?: number; category?: string; currency?: string }): DetectTx[] {
  const rnd = lcg(p.seed ?? 7)
  const out: DetectTx[] = []
  let d = p.start
  for (let i = 0; i < p.count; i++) {
    const jd = p.jitterDays ? Math.round((rnd() * 2 - 1) * p.jitterDays) : 0
    const base = typeof p.cents === 'function' ? p.cents(i) : p.cents
    const jc = p.jitterCents ? Math.round((rnd() * 2 - 1) * p.jitterCents) : 0
    out.push({ id: `t${++n}`, date: addDays(d, jd), description: p.desc, aud_amount_cents: -(base + jc), category_id: p.category ?? null, is_transfer: false })
    d = advanceDate(d, p.step)
  }
  return out
}

describe('merchantKey', () => {
  it('strips card numbers, value dates, places and web noise', () => {
    expect(merchantKey('NETFLIX.COM MELBOURNE AU AUS Card xx1234 Value Date: 03/10/2026')).toBe('NETFLIX')
    expect(merchantKey('Spotify P2A9F7C1 Sydney AU')).toBe('SPOTIFY')
    expect(merchantKey('APPLE.COM/BILL SYDNEY NS AUS')).toBe('APPLE NS')
    expect(merchantKey('AMAZON PRIME AU')).toBe('AMAZON PRIME')
    expect(merchantKey('Direct Debit 123456 HBF HEALTH LTD 99887766')).toBe('HBF HEALTH')
  })
  it('returns null when nothing meaningful is left', () => {
    expect(merchantKey('INTERNATIONAL TRANSACTION FEE')).toBeNull()
    expect(merchantKey('12345 6789')).toBeNull()
  })
})

describe('detectSubscriptions: golden cases', () => {
  it('finds a monthly subscription with jittered dates', () => {
    const txs = series({ desc: 'NETFLIX.COM MELBOURNE AU', start: '2026-05-03', count: 7, cents: 2299, step: 'monthly', jitterDays: 3 })
    const [s] = detectSubscriptions(txs, TODAY)
    expect(s.key).toBe('NETFLIX|monthly')
    expect(s.merchant).toBe('Netflix')
    expect(s.amountCents).toBe(2299)
    expect(s.monthlyCents).toBe(2299)
    expect(s.annualCents).toBe(27588)
    expect(s.active).toBe(true)
    expect(s.nextDue! >= TODAY).toBe(true)
    expect(s.count).toBe(7)
  })

  it('finds weekly, fortnightly, quarterly and annual cadences', () => {
    const txs = [
      ...series({ desc: 'GYM CLUB PERTH', start: '2026-08-04', count: 14, cents: 1990, step: 'weekly', jitterDays: 1 }),
      ...series({ desc: 'CLEANER SERVICES', start: '2026-05-01', count: 13, cents: 12000, step: 'fortnightly', jitterDays: 1 }),
      ...series({ desc: 'SYNERGY ELECTRICITY', start: '2025-12-10', count: 4, cents: 41000, step: 'quarterly', jitterDays: 5, jitterCents: 1500 }),
      ...series({ desc: 'RAC INSURANCE ANNUAL', start: '2024-12-01', count: 2, cents: 98000, step: 'annual', jitterDays: 4 }),
    ]
    const subs = detectSubscriptions(txs, TODAY)
    const byMerchant = Object.fromEntries(subs.map(s => [s.merchantKey, s.cadence]))
    expect(byMerchant).toMatchObject({ 'GYM CLUB': 'weekly', CLEANER: 'fortnightly', SYNERGY: 'quarterly', 'RAC INSURANCE': 'annual' })
    const gym = subs.find(s => s.merchantKey === 'GYM CLUB')!
    expect(gym.monthlyCents).toBe(Math.round(1990 * 52 / 12))
  })

  it('splits two subscriptions from one merchant by amount', () => {
    const txs = [
      ...series({ desc: 'APPLE.COM/BILL SYDNEY', start: '2026-04-02', count: 8, cents: 299, step: 'monthly', jitterDays: 1 }),
      ...series({ desc: 'APPLE.COM/BILL SYDNEY', start: '2026-04-15', count: 8, cents: 1499, step: 'monthly', jitterDays: 1, seed: 3 }),
    ]
    const subs = detectSubscriptions(txs, TODAY)
    expect(subs.map(s => s.amountCents).sort((a, b) => a - b)).toEqual([299, 1499])
    expect(new Set(subs.map(s => s.key)).size).toBe(2)
    expect(subs.every(s => s.key.startsWith('APPLE|monthly|'))).toBe(true)
  })

  it('detects a price rise and keeps it as one subscription', () => {
    const txs = series({ desc: 'NETFLIX.COM', start: '2026-04-05', count: 8, cents: i => (i < 6 ? 2299 : 2599), step: 'monthly', jitterDays: 2 })
    const [s] = detectSubscriptions(txs, TODAY)
    expect(s.priceChange).toMatchObject({ fromCents: 2299, toCents: 2599 })
    expect(s.amountCents).toBe(2599)
  })

  it('does not report jitter on a variable bill as a price change', () => {
    const txs = series({ desc: 'WATER CORP', start: '2026-03-20', count: 8, cents: 9000, step: 'monthly', jitterCents: 300, jitterDays: 2 })
    const [s] = detectSubscriptions(txs, TODAY)
    expect(s).toBeDefined()
    expect(s.priceChange).toBeNull()
  })

  it('ignores irregular shopping with varying totals', () => {
    const rnd = lcg(11)
    const txs: DetectTx[] = Array.from({ length: 30 }, (_, i) => ({
      id: `w${i}`, date: addDays('2026-06-01', i * 5 + Math.round(rnd() * 3)), description: 'WOOLWORTHS 1234 PERTH',
      aud_amount_cents: -Math.round(4000 + rnd() * 20000), category_id: 'groceries',
    }))
    expect(detectSubscriptions(txs, TODAY)).toEqual([])
  })

  it('ignores a weekly shop on the same day each week when the total moves around', () => {
    const txs = series({ desc: 'COLES 0456', start: '2026-07-04', count: 16, cents: 15000, step: 'weekly', jitterCents: 6000 })
    expect(detectSubscriptions(txs, TODAY)).toEqual([])
  })

  it('needs enough charges: two monthly charges are not yet a subscription (first month of data)', () => {
    const txs = series({ desc: 'STAN.COM.AU', start: '2026-10-01', count: 2, cents: 1200, step: 'monthly' })
    expect(detectSubscriptions(txs, TODAY)).toEqual([])
  })

  it('excludes transfers and money in', () => {
    const txs = series({ desc: 'TRANSFER TO SAVINGS', start: '2026-03-01', count: 8, cents: 50000, step: 'monthly' })
      .map(t => ({ ...t, is_transfer: true }))
    const refunds = series({ desc: 'SPOTIFY', start: '2026-03-01', count: 8, cents: 1299, step: 'monthly' }).map(t => ({ ...t, aud_amount_cents: -t.aud_amount_cents }))
    expect(detectSubscriptions([...txs, ...refunds], TODAY)).toEqual([])
  })

  it('compares EUR charges on their AUD amount', () => {
    // A €9.99 charge converted at slightly different rates each month.
    const txs = series({ desc: 'IRISH TIMES DIGITAL DUBLIN IE', start: '2026-05-08', count: 6, cents: 1650, jitterCents: 40, step: 'monthly' })
    const [s] = detectSubscriptions(txs, TODAY)
    expect(s.merchantKey).toBe('IRISH TIMES')
    expect(s.amountCents).toBeGreaterThan(1600)
  })

  it('marks new and ended subscriptions', () => {
    const fresh = series({ desc: 'STAN.COM.AU', start: '2026-08-10', count: 4, cents: 1200, step: 'monthly', jitterDays: 1 })
    const ended = series({ desc: 'BINGE', start: '2025-09-02', count: 6, cents: 1800, step: 'monthly' }) // last charge Feb 2026
    const subs = detectSubscriptions([...fresh, ...ended], TODAY)
    const stan = subs.find(s => s.merchantKey === 'STAN')!
    const binge = subs.find(s => s.merchantKey === 'BINGE')!
    expect(stan.isNew).toBe(true)
    expect(stan.active).toBe(true)
    expect(binge.active).toBe(false)
    expect(binge.nextDue).toBeNull()
  })

  it('tolerates one missed month', () => {
    const txs = series({ desc: 'SPOTIFY', start: '2026-03-01', count: 9, cents: 1399, step: 'monthly' }).filter((_, i) => i !== 4)
    expect(detectSubscriptions(txs, TODAY)).toHaveLength(1)
  })
})

describe('priceChangeOf', () => {
  const c = (date: string, cents: number) => ({ date, cents })
  it('needs two charges at the old price', () => {
    expect(priceChangeOf([c('2026-09-01', 1000), c('2026-10-01', 1200), c('2026-11-01', 1200)], TODAY)).toBeNull()
  })
  it('ignores moves under 50c and old changes', () => {
    expect(priceChangeOf([c('2026-08-01', 1000), c('2026-09-01', 1000), c('2026-10-01', 1030)], TODAY)).toBeNull()
    expect(priceChangeOf([c('2025-01-01', 1000), c('2025-02-01', 1000), c('2025-03-01', 1300), c('2025-04-01', 1300)], TODAY)).toBeNull()
  })
})

describe('bills', () => {
  const subs = detectSubscriptions([
    ...series({ desc: 'NETFLIX.COM', start: '2026-05-20', count: 6, cents: 2299, step: 'monthly' }),
    ...series({ desc: 'SPOTIFY', start: '2026-05-02', count: 7, cents: 1399, step: 'monthly' }),
  ], TODAY)

  it('lists upcoming detected and planned bills, soonest first', () => {
    const bills = upcomingBills({
      subscriptions: subs, marks: [], today: TODAY, days: 35, fx: { EUR: 1.7 },
      planned: [{ id: 'p1', description: 'Rent', amountCents: -250000, currency: 'AUD', frequency: 'fortnightly', nextDue: '2026-11-06' }, { id: 'p2', description: 'Irish phone', amountCents: -1000, currency: 'EUR', frequency: 'monthly', nextDue: '2026-11-25' }],
    })
    expect(bills.map(b => b.date)).toEqual([...bills.map(b => b.date)].sort())
    expect(bills.filter(b => b.label === 'Rent').map(b => b.date)).toEqual(['2026-11-20', '2026-12-04', '2026-12-18'])
    expect(bills.find(b => b.label === 'Netflix')!.date).toBe('2026-11-20')
    expect(bills.find(b => b.label === 'Irish phone')!.cents).toBe(1700)
    expect(bills.every(b => b.date >= TODAY && b.date <= '2026-12-18')).toBe(true)
  })

  it('leaves out dismissed and tracked subscriptions', () => {
    const marks = [{ key: 'NETFLIX|monthly', state: 'tracked' as const, refId: 'p9' }, { key: 'SPOTIFY|monthly', state: 'dismissed' as const, refId: null }]
    expect(upcomingBills({ subscriptions: subs, marks, planned: [], today: TODAY })).toEqual([])
    const v = visibleSubscriptions(subs, marks)
    expect(v.tracked.map(s => s.key)).toEqual(['NETFLIX|monthly'])
    expect(v.dismissed.map(s => s.key)).toEqual(['SPOTIFY|monthly'])
  })

  it('builds Monday-first calendar weeks covering the range', () => {
    const weeks = billCalendar([], TODAY, 35)
    expect(weeks[0][0].date).toBe('2026-11-09') // Monday
    expect(weeks.flat().some(d => d.date === addDays(TODAY, 35))).toBe(true)
    expect(weeks.flat().filter(d => d.inRange)).toHaveLength(36)
  })
})
