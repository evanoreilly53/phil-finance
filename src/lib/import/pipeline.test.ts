import { describe, it, expect } from 'vitest'
import { planImport, type NormalisedRow, type ExistingRow } from './pipeline'
import { assignFingerprints } from './fingerprint'

const accounts = [
  { id: 'joint', account_number_hint: '1111' },
  { id: 'savings', account_number_hint: '4821' },
]
const rules = [
  { pattern: 'woolworths|coles', category_id: 'groceries', owner: null, priority: 1, is_active: true },
]
const base = (over: Partial<NormalisedRow>): NormalisedRow => ({
  account_id: 'joint', owner: 'joint', date: '2026-10-28', description: 'x', amount_cents: -100,
  currency: 'AUD', aud_amount_cents: -100, fx_rate: 1, balance_cents: null, category_id: null, notes: null, ...over,
})
let n = 0
const newId = () => `new-${++n}`

describe('planImport', () => {
  it('skips exact duplicates, categorises, detects transfers and flags the rest', () => {
    const rows = [
      base({ description: 'WOOLWORTHS 1234 PERTH', amount_cents: -4550, aud_amount_cents: -4550 }),
      base({ description: 'Transfer to xx4821 NetBank', amount_cents: -100000, aud_amount_cents: -100000 }),
      base({ description: 'Mystery shop', amount_cents: -999, aud_amount_cents: -999 }),
      base({ date: '2026-10-27', description: 'Coffee', amount_cents: -500, aud_amount_cents: -500 }),
    ]
    const fpCoffee = assignFingerprints([rows[3]])[0]
    const existing: ExistingRow[] = [
      { id: 'stored-coffee', account_id: 'joint', date: '2026-10-27', amount_cents: -500, aud_amount_cents: -500, description: 'Coffee', external_id: fpCoffee, is_transfer: false, transfer_peer_id: null },
      { id: 'sav-leg', account_id: 'savings', date: '2026-10-28', amount_cents: 100000, aud_amount_cents: 100000, description: 'Transfer from xx1111', external_id: null, is_transfer: false, transfer_peer_id: null },
    ]
    const plan = planImport({ rows, existing, accounts, rules, newId })

    expect(plan.rows.map(r => r.status)).toEqual(['import', 'import', 'import', 'skip_duplicate'])
    expect(plan.rows[0].category_id).toBe('groceries')
    expect(plan.rows[1]).toMatchObject({ is_transfer: true, transfer_account_id: 'savings', transfer_peer_id: 'sav-leg', category_id: null })
    expect(plan.peerUpdates).toEqual([{ id: 'sav-leg', transfer_peer_id: plan.rows[1].id, transfer_account_id: 'joint', is_transfer: true, flag: false }])
    expect(plan.rows[2].category_id).toBeNull()
    expect(plan.summary).toMatchObject({
      total: 4, toImport: 3, duplicates: 1, transfers: 1, uncategorised: 1,
      dateFrom: '2026-10-27', dateTo: '2026-10-28',
    })
    expect(plan.rows.every(r => r.external_id.startsWith('v1:'))).toBe(true)
  })

  it('keeps a file category over the rules', () => {
    const plan = planImport({ rows: [base({ description: 'Coles', category_id: 'treats' })], existing: [], accounts, rules, newId })
    expect(plan.rows[0].category_id).toBe('treats')
  })

  it('pairs both legs when a multi-account generic file holds them', () => {
    const rows = [
      base({ account_id: 'joint', description: 'Transfer out', amount_cents: -2000, aud_amount_cents: -2000 }),
      base({ account_id: 'savings', description: 'Transfer in', amount_cents: 2000, aud_amount_cents: 2000 }),
    ]
    const plan = planImport({ rows, existing: [], accounts, rules, newId })
    expect(plan.rows[0]).toMatchObject({ is_transfer: true, transfer_peer_id: plan.rows[1].id, transfer_account_id: 'savings' })
    expect(plan.rows[1]).toMatchObject({ is_transfer: true, transfer_peer_id: plan.rows[0].id, transfer_account_id: 'joint' })
    expect(plan.summary.transfers).toBe(2)
  })

  it('flags possible duplicates with the suspected original', () => {
    const plan = planImport({
      rows: [base({ date: '2026-10-29', description: 'WOOLWORTHS PERTH', amount_cents: -4550, aud_amount_cents: -4550 })],
      existing: [{ id: 'm', account_id: 'joint', date: '2026-10-27', amount_cents: -4550, aud_amount_cents: -4550, description: 'Woolworths', external_id: null, is_transfer: false, transfer_peer_id: null }],
      accounts, rules, newId,
    })
    expect(plan.rows[0]).toMatchObject({ status: 'import', duplicate_of_id: 'm', review_flags: ['suspected_duplicate'] })
    expect(plan.summary.possibleDuplicates).toBe(1)
  })

  it('re-importing the same file twice imports nothing the second time', () => {
    const rows = [base({ description: 'A' }), base({ description: 'A' }), base({ description: 'B', amount_cents: -7, aud_amount_cents: -7 })]
    const first = planImport({ rows, existing: [], accounts, rules, newId })
    const stored: ExistingRow[] = first.rows.map(r => ({ ...r, is_transfer: false, transfer_peer_id: null }))
    const second = planImport({ rows, existing: stored, accounts, rules, newId })
    expect(second.summary.toImport).toBe(0)
    expect(second.summary.duplicates).toBe(3)
  })
})
