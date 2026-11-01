// The import plan: given normalised rows from any profile (CommBank or the
// generic column-mapped CSV) plus what's already stored, decide what to insert,
// what to skip and what to send to the review queue. Pure, so the preview and
// the server-side commit run exactly the same logic.

import { matchCategory } from '../categorise'
import { assignFingerprints } from './fingerprint'
import { classifyDuplicates, type DedupeExisting } from './dedupe'
import { matchTransfers, type TransferAccount, type TransferCandidate, type TransferMatch } from './transfers'
import type { ReviewFlag } from '../supabase/database.types'

export type ImportOwner = 'joint' | 'rachel' | 'evan'

export type NormalisedRow = {
  account_id: string
  owner: ImportOwner
  date: string               // YYYY-MM-DD
  description: string
  amount_cents: number       // native, signed
  currency: string
  aud_amount_cents: number
  fx_rate: number
  balance_cents: number | null
  category_id: string | null // explicit from the file, else rules decide
  notes: string | null
}

export type ExistingRow = DedupeExisting & TransferCandidate

export type PlannedRow = NormalisedRow & {
  id: string
  external_id: string
  status: 'import' | 'skip_duplicate'
  duplicate_of_id: string | null
  is_transfer: boolean
  transfer_account_id: string | null
  transfer_peer_id: string | null
  review_flags: ReviewFlag[]
}

/** Updates to already-stored rows that turned out to be the other leg of a transfer. */
export type PeerUpdate = { id: string; transfer_peer_id: string; transfer_account_id: string; is_transfer: boolean; flag: boolean }

export type ImportSummary = {
  total: number
  toImport: number
  duplicates: number
  possibleDuplicates: number
  transfers: number
  suspectedTransfers: number
  uncategorised: number
  dateFrom: string | null
  dateTo: string | null
}

export type ImportPlan = { rows: PlannedRow[]; peerUpdates: PeerUpdate[]; summary: ImportSummary }

type Rule = Parameters<typeof matchCategory>[2][number]

export function planImport(input: {
  rows: readonly NormalisedRow[]
  /** Stored rows in the date window: same accounts (dedupe) and all accounts (transfer legs). */
  existing: readonly ExistingRow[]
  accounts: readonly TransferAccount[]
  rules: readonly Rule[]
  newId: () => string
}): ImportPlan {
  const { rows, existing, accounts, rules, newId } = input

  // Fingerprints are per account, in file order
  const fps: string[] = new Array(rows.length)
  const byAccount = new Map<string, number[]>()
  rows.forEach((r, i) => { const l = byAccount.get(r.account_id) ?? []; l.push(i); byAccount.set(r.account_id, l) })
  for (const [, idxs] of byAccount) {
    const f = assignFingerprints(idxs.map(i => rows[i]))
    idxs.forEach((i, k) => { fps[i] = f[k] })
  }

  // Dedupe per account
  const dedupe = new Array<ReturnType<typeof classifyDuplicates>[number]>(rows.length)
  for (const [acc, idxs] of byAccount) {
    const res = classifyDuplicates(
      idxs.map(i => ({ ...rows[i], fingerprint: fps[i] })),
      existing.filter(e => e.account_id === acc),
    )
    idxs.forEach((i, k) => { dedupe[i] = res[k] })
  }

  const planned: PlannedRow[] = rows.map((r, i) => {
    const d = dedupe[i]
    return {
      ...r,
      id: newId(),
      external_id: fps[i],
      status: d.status === 'duplicate' ? 'skip_duplicate' : 'import',
      duplicate_of_id: d.status === 'possible_duplicate' ? d.matchId : null,
      is_transfer: false,
      transfer_account_id: null,
      transfer_peer_id: null,
      review_flags: d.status === 'possible_duplicate' ? ['suspected_duplicate'] : [],
    }
  })

  // Transfers: first against stored rows, then between rows of this file
  const live = planned.filter(p => p.status === 'import')
  const vsStored = matchTransfers(live, existing.filter(e => e.account_id !== null), accounts)
  const peerUpdates: PeerUpdate[] = []
  const apply = (p: PlannedRow, m: TransferMatch) => {
    if (m.kind === 'none') return
    p.transfer_account_id = m.accountId
    p.transfer_peer_id = m.peerId
    if (m.kind === 'transfer') p.is_transfer = true
    else if (!p.review_flags.includes('suspected_transfer')) p.review_flags.push('suspected_transfer')
  }
  live.forEach((p, k) => {
    const m = vsStored[k]
    apply(p, m)
    if (m.kind !== 'none' && m.peerId) {
      peerUpdates.push({ id: m.peerId, transfer_peer_id: p.id, transfer_account_id: p.account_id, is_transfer: m.kind === 'transfer', flag: m.kind === 'suspected' })
    }
  })

  const unpaired = live.filter(p => !p.transfer_peer_id && !(p.is_transfer && p.transfer_account_id))
  if (byAccount.size > 1 && unpaired.length > 1) {
    const asCandidates: TransferCandidate[] = unpaired.map(p => ({ ...p, is_transfer: false, transfer_peer_id: null }))
    const matches = matchTransfers(unpaired, asCandidates, accounts)
    const byId = new Map(unpaired.map(p => [p.id, p]))
    unpaired.forEach((p, k) => {
      const m = matches[k]
      if (m.kind === 'none' || p.transfer_peer_id) return
      if (m.peerId) {
        const peer = byId.get(m.peerId)!
        if (peer.transfer_peer_id) return // already claimed by an earlier row
        apply(p, m)
        apply(peer, { ...m, accountId: p.account_id, peerId: p.id })
      } else {
        apply(p, m)
      }
    })
  }

  // Categorise what isn't a transfer and has no explicit category
  for (const p of planned) {
    if (p.is_transfer) { p.category_id = p.category_id ?? null; continue }
    if (!p.category_id) p.category_id = matchCategory(p.description, p.owner, [...rules]) ?? null
  }

  const imp = planned.filter(p => p.status === 'import')
  // The file's whole date range (duplicates included): an export that only
  // repeats known rows still proves the account is current to its last date.
  const dates = planned.map(p => p.date).sort()
  return {
    rows: planned,
    peerUpdates,
    summary: {
      total: planned.length,
      toImport: imp.length,
      duplicates: planned.length - imp.length,
      possibleDuplicates: imp.filter(p => p.review_flags.includes('suspected_duplicate')).length,
      transfers: imp.filter(p => p.is_transfer).length,
      suspectedTransfers: imp.filter(p => p.review_flags.includes('suspected_transfer')).length,
      uncategorised: imp.filter(p => !p.is_transfer && !p.category_id).length,
      dateFrom: dates[0] ?? null,
      dateTo: dates[dates.length - 1] ?? null,
    },
  }
}
