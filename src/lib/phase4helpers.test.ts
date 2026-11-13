import { describe, it, expect } from 'vitest'
import { budgetPace, monthFraction, paceStatus, suggestTarget } from './budgetPace'
import { superCapLines, contributionsInFy, fyBounds, type ConcessionalRow } from './superCap'
import { weddingArchiveState, archiveUpdate } from './wedding'
import { explainNetWorth } from './checkin'

const $ = (d: number) => Math.round(d * 100)

describe('budget pace', () => {
  it('knows how far through the month we are', () => {
    expect(monthFraction('2026-11-15')).toBe(0.5)
    expect(monthFraction('2026-02-28')).toBe(1)
  })
  it('on track / ahead of pace / over / no target', () => {
    expect(paceStatus($(400), $(1000), 0.5)).toEqual({ status: 'on_track', expectedCents: $(500) })
    expect(paceStatus($(560), $(1000), 0.5).status).toBe('on_track')  // within 10% + $20
    expect(paceStatus($(600), $(1000), 0.5).status).toBe('ahead')
    expect(paceStatus($(1001), $(1000), 0.9).status).toBe('over')
    expect(paceStatus($(50), 0, 0.5).status).toBe('no_target')
  })
  it('suggests the trailing average rounded up to $10, never tiny amounts', () => {
    expect(suggestTarget([$(612), $(700), $(655)])).toBe($(660))
    expect(suggestTarget([])).toBeNull()
    expect(suggestTarget([$(10), $(15)])).toBeNull()
  })
  it('builds lines with targets first, offering suggestions where there is history', () => {
    const lines = budgetPace({
      categories: [{ id: 'eat', name: 'Eating out' }, { id: 'groc', name: 'Groceries' }, { id: 'pets', name: 'Pets' }],
      targets: new Map([['groc', $(900)]]),
      spent: new Map([['eat', $(300)], ['groc', $(600)]]),
      history: new Map([['eat', [$(600), $(700)]]]),
      today: '2026-11-15',
    })
    expect(lines.map(l => [l.id, l.status])).toEqual([['groc', 'ahead'], ['eat', 'no_target']])
    expect(lines[1].suggestedCents).toBe($(650))
  })
})

describe('super cap tracker', () => {
  const rows: ConcessionalRow[] = [
    { id: 'a', person_key: 'evan', amount_cents: $(2000), frequency: 'once', start_date: '2026-09-01', end_date: null, status: 'paid', description: 'Personal contribution' },
    { id: 'b', person_key: 'evan', amount_cents: $(500), frequency: 'monthly', start_date: '2027-01-15', end_date: null, status: 'planned', description: 'Salary sacrifice' },
    { id: 'c', person_key: 'evan', amount_cents: $(9000), frequency: 'once', start_date: '2026-03-01', end_date: null, status: 'paid', description: 'Last FY' },
    { id: 'd', person_key: 'evan', amount_cents: $(9000), frequency: 'once', start_date: '2026-12-01', end_date: null, status: 'cancelled', description: 'Cancelled' },
    { id: 'e', person_key: 'rachel', amount_cents: $(1000), frequency: 'once', start_date: '2026-10-01', end_date: null, status: 'planned', description: 'R' },
  ]
  it('knows the FY bounds', () => {
    expect(fyBounds('2026-11-13')).toEqual({ fy: 'FY2026-27', start: '2026-07-01', end: '2027-06-30' })
    expect(fyBounds('2027-03-01').start).toBe('2026-07-01')
  })
  it('counts only this FY’s, non-cancelled contributions (recurring ones by occurrence)', () => {
    const e = contributionsInFy(rows, 'evan', '2026-11-13')
    expect(e.map(x => [x.row.id, x.cents])).toEqual([['a', $(2000)], ['b', $(3000)]]) // Jan–Jun = 6 × $500
  })
  it('works out SG from gross salary and the headroom left', () => {
    const [evan, rachel] = superCapLines([
      { key: 'evan', name: 'Evan', grossCents: $(135000), hasPrivateHospital: true, hasHecs: false },
      { key: 'rachel', name: 'Rachel', grossCents: $(107000), hasPrivateHospital: true, hasHecs: false },
    ], rows, '2026-11-13')
    expect(evan).toMatchObject({ fy: 'FY2026-27', sgCents: $(16200), voluntaryCents: $(5000), capCents: $(32500), headroomCents: $(32500 - 16200 - 5000) })
    expect(rachel).toMatchObject({ sgCents: $(12840), voluntaryCents: $(1000), headroomCents: $(32500 - 12840 - 1000) })
    expect(evan.daysLeft).toBe(229)
  })
})

describe('wedding archive', () => {
  const paid = { status: 'paid' as const, budget_aud_cents: $(10000), spent_aud_cents: $(9800), spent_eur_cents: $(6000) }
  const open = { status: 'deposit_paid' as const, budget_aud_cents: $(5000), spent_aud_cents: $(1000), balance_owed_eur_cents: $(2000) }
  it('stays open while anything is unpaid', () => {
    const s = weddingArchiveState([paid, open], { is_archived: false, params: {} })
    expect(s).toMatchObject({ archived: false, openItems: 1, allPaid: false, canArchive: true })
    expect(s.totals.owedEurCents).toBe($(2000))
  })
  it('archives automatically once everything is paid (cancelled items ignored)', () => {
    const s = weddingArchiveState([paid, { ...open, status: 'cancelled' }], { is_archived: false, params: {} })
    expect(s).toMatchObject({ archived: true, reason: 'all_paid', allPaid: true })
    expect(s.totals).toMatchObject({ spentAudCents: $(9800), items: 1 })
  })
  it('archives on the button even with items open, and reopens reversibly', () => {
    expect(weddingArchiveState([paid, open], { is_archived: true, params: {} })).toMatchObject({ archived: true, reason: 'pressed', canArchive: false })
    const reopened = archiveUpdate({ source: 'wedding_items' }, false)
    expect(reopened).toEqual({ is_archived: false, params: { source: 'wedding_items', keep_open: true } })
    expect(weddingArchiveState([paid], reopened).archived).toBe(false)
    expect(archiveUpdate(reopened.params, true)).toEqual({ is_archived: true, params: { source: 'wedding_items' } })
  })
  it('no items, no event: open', () => {
    expect(weddingArchiveState([], null)).toMatchObject({ archived: false, allPaid: false })
  })
})

describe('net worth explained', () => {
  it('splits the change into money in, spending and the rest, adding up exactly', () => {
    const snapshots = [
      { account_id: 'joint', date: '2026-09-28', aud_balance_cents: $(20000) },
      { account_id: 'joint', date: '2026-10-30', aud_balance_cents: $(23000) },
      { account_id: 'super', date: '2026-09-30', aud_balance_cents: $(100000) },
      { account_id: 'super', date: '2026-10-31', aud_balance_cents: $(101500) },
      { account_id: 'aib', date: '2026-08-01', aud_balance_cents: $(3000) }, // not updated: carried forward
    ]
    const txs = [
      { date: '2026-10-15', aud_amount_cents: $(9000), category_id: 'sal', is_transfer: false },
      { date: '2026-10-16', aud_amount_cents: -$(5500), category_id: 'groc', is_transfer: false },
      { date: '2026-10-17', aud_amount_cents: -$(2000), category_id: null, is_transfer: true },
    ]
    const cats = [{ id: 'sal', parent_id: null, kind: 'income' as const }, { id: 'groc', parent_id: null, kind: 'essential' as const }]
    const r = explainNetWorth({ month: '2026-10', snapshots, accounts: [{ id: 'joint', name: 'Joint' }, { id: 'super', name: 'Super' }, { id: 'aib', name: 'AIB' }], txs, categories: cats })
    expect(r.changeCents).toBe($(4500))
    expect(r.rows.map(x => x.cents)).toEqual([$(9000), -$(5500), $(1000)])
    expect(r.rows.reduce((s, x) => s + x.cents, 0)).toBe(r.changeCents)
    expect(r.accounts.find(a => a.id === 'aib')).toMatchObject({ changeCents: 0, updated: false })
    expect(r.rows[2].detail).toContain('1 account not updated')
  })
})
