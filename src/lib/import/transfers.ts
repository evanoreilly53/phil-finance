// Transfer detection between the household's own accounts. Pure.
//
// A transfer moves money between your own accounts, so it's neither spending
// nor income. Signals:
//   (a) the description names one of your accounts: "Transfer to xx4821 NetBank"
//       (accounts.account_number_hint = "4821")
//   (b) a mirror leg: the same AUD amount with the opposite sign in another of
//       your accounts within ±3 days
//   (c) a transfer keyword ("transfer", "tfr", "xfer")
//
//   (a)            → transfer (one-legged is fine, e.g. into Vanguard which has no feed)
//   (b) + (c)      → transfer, both legs linked
//   (b) alone      → suspected (review queue suggests the pairing)
//   (c) alone      → suspected (could be rent paid by transfer to the landlord)

import { dayDiff } from './dates'

export const TRANSFER_RE = /\b(transfer|tfr|xfer)\b/i

export type TransferAccount = { id: string; account_number_hint: string | null }
export type TransferIncoming = { account_id: string; date: string; aud_amount_cents: number; description: string }
export type TransferCandidate = {
  id: string
  account_id: string | null
  date: string
  aud_amount_cents: number
  description: string
  is_transfer: boolean
  transfer_peer_id: string | null
}
export type TransferMatch =
  | { kind: 'none' }
  | { kind: 'transfer'; accountId: string | null; peerId: string | null }
  | { kind: 'suspected'; accountId: string | null; peerId: string | null }

export function hasTransferKeyword(description: string): boolean {
  return TRANSFER_RE.test(description)
}

/** Which of our other accounts the description refers to, if any (needs a transfer keyword). */
export function findAccountReference(description: string, accounts: readonly TransferAccount[], selfId: string): string | null {
  if (!hasTransferKeyword(description)) return null
  // Drop the card used for the purchase ("Card xx1234") so it isn't read as a destination
  const d = description.replace(/\bcard\s+x+\d{2,6}\b/gi, ' ')
  for (const a of accounts) {
    if (a.id === selfId || !a.account_number_hint) continue
    const re = new RegExp(`(?:\\bx+|\\*+|\\b)${a.account_number_hint}\\b`, 'i')
    if (re.test(d)) return a.id
  }
  return null
}

export function matchTransfers(
  incoming: readonly TransferIncoming[],
  candidates: readonly TransferCandidate[],
  accounts: readonly TransferAccount[],
  opts: { windowDays?: number } = {},
): TransferMatch[] {
  const windowDays = opts.windowDays ?? 3
  const used = new Set<string>()

  return incoming.map(r => {
    if (r.aud_amount_cents === 0) return { kind: 'none' } as const
    const ref = findAccountReference(r.description, accounts, r.account_id)
    const keyword = hasTransferKeyword(r.description)

    // Mirror legs, closest date first; prefer the referenced account
    let peer: TransferCandidate | null = null
    let bestScore = Infinity
    for (const c of candidates) {
      if (used.has(c.id) || c.is_transfer || c.transfer_peer_id || !c.account_id) continue
      if (c.account_id === r.account_id || c.aud_amount_cents !== -r.aud_amount_cents) continue
      const gap = Math.abs(dayDiff(c.date, r.date))
      if (gap > windowDays) continue
      const score = gap + (ref && c.account_id !== ref ? 100 : 0)
      if (score < bestScore) { bestScore = score; peer = c }
    }
    if (ref && peer && peer.account_id !== ref) peer = null // don't pair with the wrong account

    const peerKeyword = peer ? hasTransferKeyword(peer.description) : false
    if (ref) {
      if (peer) used.add(peer.id)
      return { kind: 'transfer', accountId: ref, peerId: peer?.id ?? null } as const
    }
    if (peer && (keyword || peerKeyword)) {
      used.add(peer.id)
      return { kind: 'transfer', accountId: peer.account_id, peerId: peer.id } as const
    }
    if (peer) {
      used.add(peer.id)
      return { kind: 'suspected', accountId: peer.account_id, peerId: peer.id } as const
    }
    if (keyword) return { kind: 'suspected', accountId: null, peerId: null } as const
    return { kind: 'none' } as const
  })
}
