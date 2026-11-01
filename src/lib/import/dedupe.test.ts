import { describe, it, expect } from 'vitest'
import { classifyDuplicates } from './dedupe'
import { assignFingerprints } from './fingerprint'

const row = (date: string, amount_cents: number, description: string) => ({ date, amount_cents, description })
const withFp = <T extends { date: string; amount_cents: number; description: string }>(rows: T[]) => {
  const fps = assignFingerprints(rows)
  return rows.map((r, i) => ({ ...r, fingerprint: fps[i] }))
}

describe('classifyDuplicates', () => {
  it('skips rows whose fingerprint is already stored', () => {
    const inc = withFp([row('2026-10-01', -500, 'Coffee'), row('2026-10-02', -900, 'Lunch')])
    const res = classifyDuplicates(inc, [{ id: 'e1', ...inc[0], external_id: inc[0].fingerprint }])
    expect(res[0]).toEqual({ status: 'duplicate', matchId: 'e1', reason: 'fingerprint' })
    expect(res[1]).toEqual({ status: 'new' })
  })

  it('keeps the second identical coffee when only one was stored', () => {
    const inc = withFp([row('2026-10-01', -500, 'Coffee'), row('2026-10-01', -500, 'Coffee')])
    const res = classifyDuplicates(inc, [{ id: 'e1', ...inc[0], external_id: inc[0].fingerprint }])
    expect(res[0].status).toBe('duplicate')
    // the stored row is used up, so #2 is only a same-day possible duplicate, never silently skipped
    expect(res[1].status).not.toBe('duplicate')
  })

  it('treats a legacy (no fingerprint) row with same date/amount/merchant as a duplicate', () => {
    const inc = withFp([row('2026-10-01', -4550, 'WOOLWORTHS 1234 PERTH AU')])
    const res = classifyDuplicates(inc, [{ id: 'old', date: '2026-10-01', amount_cents: -4550, description: 'Woolworths Perth', external_id: null }])
    expect(res[0]).toEqual({ status: 'duplicate', matchId: 'old', reason: 'same_day_match' })
  })

  it('flags (not skips) a near match a couple of days apart', () => {
    const inc = withFp([row('2026-10-03', -4550, 'WOOLWORTHS PERTH')])
    const res = classifyDuplicates(inc, [{ id: 'old', date: '2026-10-01', amount_cents: -4550, description: 'Woolworths', external_id: null }])
    expect(res[0]).toEqual({ status: 'possible_duplicate', matchId: 'old' })
  })

  it('flags same-day same-amount even with different text', () => {
    const inc = withFp([row('2026-10-01', -2000, 'BPAY SYNERGY')])
    const res = classifyDuplicates(inc, [{ id: 'm', date: '2026-10-01', amount_cents: -2000, description: 'Electricity bill', external_id: null }])
    expect(res[0].status).toBe('possible_duplicate')
  })

  it('ignores different amounts and rows outside the window', () => {
    const inc = withFp([row('2026-10-10', -2000, 'Coles')])
    const res = classifyDuplicates(inc, [
      { id: 'a', date: '2026-10-10', amount_cents: -2001, description: 'Coles', external_id: null },
      { id: 'b', date: '2026-10-01', amount_cents: -2000, description: 'Coles', external_id: null },
    ])
    expect(res[0]).toEqual({ status: 'new' })
  })

  it('lets each stored row explain only one incoming row', () => {
    const inc = withFp([row('2026-10-01', -500, 'Coffee A'), row('2026-10-01', -500, 'Coffee B')])
    const res = classifyDuplicates(inc, [{ id: 'x', date: '2026-10-01', amount_cents: -500, description: 'Coffee', external_id: null }])
    expect(res.filter(r => r.status !== 'new')).toHaveLength(1)
  })
})
