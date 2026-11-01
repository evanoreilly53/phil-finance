import { describe, it, expect } from 'vitest'
import { matchTransfers, findAccountReference, hasTransferKeyword } from './transfers'

const accounts = [
  { id: 'joint', account_number_hint: '1111' },
  { id: 'savings', account_number_hint: '4821' },
  { id: 'vanguard', account_number_hint: '7777' },
  { id: 'nohint', account_number_hint: null },
]
const inc = (account_id: string, date: string, aud_amount_cents: number, description: string) => ({ account_id, date, aud_amount_cents, description })
const cand = (id: string, account_id: string, date: string, aud_amount_cents: number, description = 'x') =>
  ({ id, account_id, date, aud_amount_cents, description, is_transfer: false, transfer_peer_id: null })

describe('hasTransferKeyword / findAccountReference', () => {
  it('spots keywords', () => {
    expect(hasTransferKeyword('Transfer to xx4821 NetBank')).toBe(true)
    expect(hasTransferKeyword('TFR 123')).toBe(true)
    expect(hasTransferKeyword('Transferwise fees')).toBe(false)
  })
  it('finds our account by its last digits', () => {
    expect(findAccountReference('Transfer to xx4821 NetBank', accounts, 'joint')).toBe('savings')
    expect(findAccountReference('Fast Transfer From 4821', accounts, 'joint')).toBe('savings')
  })
  it('ignores the purchasing card number and self references', () => {
    expect(findAccountReference('Transfer fee Card xx4821', accounts, 'joint')).toBeNull()
    expect(findAccountReference('Transfer to xx1111', accounts, 'joint')).toBeNull()
  })
  it('needs a transfer keyword', () => {
    expect(findAccountReference('Payment xx4821', accounts, 'joint')).toBeNull()
  })
})

describe('matchTransfers', () => {
  it('pairs a referenced transfer with its mirror leg', () => {
    const [m] = matchTransfers(
      [inc('joint', '2026-10-28', -100000, 'Transfer to xx4821 NetBank')],
      [cand('s1', 'savings', '2026-10-29', 100000, 'Transfer from xx1111')],
      accounts,
    )
    expect(m).toEqual({ kind: 'transfer', accountId: 'savings', peerId: 's1' })
  })
  it('accepts a one-legged transfer to an account without a feed', () => {
    const [m] = matchTransfers([inc('joint', '2026-10-28', -50000, 'Transfer to xx7777 Vanguard')], [], accounts)
    expect(m).toEqual({ kind: 'transfer', accountId: 'vanguard', peerId: null })
  })
  it('pairs on mirror amount + keyword without a hint', () => {
    const [m] = matchTransfers(
      [inc('joint', '2026-10-28', -2500, 'NetBank transfer')],
      [cand('n1', 'nohint', '2026-10-27', 2500)],
      accounts,
    )
    expect(m).toEqual({ kind: 'transfer', accountId: 'nohint', peerId: 'n1' })
  })
  it('only suggests when the mirror leg has no transfer wording', () => {
    const [m] = matchTransfers([inc('joint', '2026-10-28', -2500, 'Payment')], [cand('n1', 'nohint', '2026-10-28', 2500, 'Deposit')], accounts)
    expect(m).toEqual({ kind: 'suspected', accountId: 'nohint', peerId: 'n1' })
  })
  it('flags a keyword-only transfer (e.g. rent to the landlord) for review', () => {
    const [m] = matchTransfers([inc('joint', '2026-10-28', -260000, 'Transfer to J SMITH rent')], [], accounts)
    expect(m).toEqual({ kind: 'suspected', accountId: null, peerId: null })
  })
  it('ignores same-account, same-sign, wrong-amount and out-of-window legs', () => {
    const res = matchTransfers(
      [inc('joint', '2026-10-28', -2500, 'Coles')],
      [
        cand('a', 'joint', '2026-10-28', 2500),
        cand('b', 'savings', '2026-10-28', -2500),
        cand('c', 'savings', '2026-10-28', 2501),
        cand('d', 'savings', '2026-10-20', 2500),
      ],
      accounts,
    )
    expect(res[0]).toEqual({ kind: 'none' })
  })
  it('never uses one leg twice and skips legs already paired', () => {
    const res = matchTransfers(
      [inc('joint', '2026-10-28', -500, 'Transfer'), inc('joint', '2026-10-28', -500, 'Transfer')],
      [cand('p', 'nohint', '2026-10-28', 500), { ...cand('q', 'nohint', '2026-10-28', 500), is_transfer: true }],
      accounts,
    )
    expect(res[0]).toEqual({ kind: 'transfer', accountId: 'nohint', peerId: 'p' })
    expect(res[1]).toEqual({ kind: 'suspected', accountId: null, peerId: null })
  })
  it('does not pair a referenced transfer with a leg in another account', () => {
    const [m] = matchTransfers(
      [inc('joint', '2026-10-28', -1000, 'Transfer to xx4821')],
      [cand('wrong', 'vanguard', '2026-10-28', 1000)],
      accounts,
    )
    expect(m).toEqual({ kind: 'transfer', accountId: 'savings', peerId: null })
  })
})
