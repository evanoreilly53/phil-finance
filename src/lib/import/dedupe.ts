// Duplicate detection for one account's incoming rows vs what's already stored.
//
//   duplicate          → skipped. Same fingerprint, OR a legacy/manual row (no
//                        fingerprint) with the same date, amount and a very
//                        similar description.
//   possible_duplicate → imported but sent to the review queue: same amount
//                        within ±windowDays and a similar description, or the
//                        same amount on the same day.
//   new                → imported.
// Each stored row can explain at most one incoming row.

import { dayDiff } from './dates'
import { descriptionSimilarity } from './fingerprint'

export type DedupeIncoming = { date: string; amount_cents: number; description: string; fingerprint: string }
export type DedupeExisting = { id: string; date: string; amount_cents: number; description: string; external_id: string | null }
export type DedupeResult =
  | { status: 'new' }
  | { status: 'duplicate'; matchId: string; reason: 'fingerprint' | 'same_day_match' }
  | { status: 'possible_duplicate'; matchId: string }

export const STRONG_SIMILARITY = 0.8
export const WEAK_SIMILARITY = 0.5

export function classifyDuplicates(
  incoming: readonly DedupeIncoming[],
  existing: readonly DedupeExisting[],
  opts: { windowDays?: number } = {},
): DedupeResult[] {
  const windowDays = opts.windowDays ?? 3
  const used = new Set<string>()
  const out: DedupeResult[] = incoming.map(() => ({ status: 'new' }))

  // Pass 1: exact fingerprints (takes priority so a fuzzy match can't steal them)
  const byFp = new Map<string, string>()
  for (const e of existing) if (e.external_id) byFp.set(e.external_id, e.id)
  incoming.forEach((r, i) => {
    const id = byFp.get(r.fingerprint)
    if (id && !used.has(id)) { used.add(id); out[i] = { status: 'duplicate', matchId: id, reason: 'fingerprint' } }
  })

  // Pass 2: fuzzy
  incoming.forEach((r, i) => {
    if (out[i].status !== 'new') return
    let best: { e: DedupeExisting; sim: number; gap: number } | null = null
    for (const e of existing) {
      if (used.has(e.id) || e.amount_cents !== r.amount_cents) continue
      const gap = Math.abs(dayDiff(e.date, r.date))
      if (gap > windowDays) continue
      const sim = descriptionSimilarity(e.description, r.description)
      if (!best || gap < best.gap || (gap === best.gap && sim > best.sim)) best = { e, sim, gap }
    }
    if (!best) return
    if (best.gap === 0 && best.sim >= STRONG_SIMILARITY && best.e.external_id === null) {
      used.add(best.e.id)
      out[i] = { status: 'duplicate', matchId: best.e.id, reason: 'same_day_match' }
    } else if (best.sim >= WEAK_SIMILARITY || best.gap === 0) {
      used.add(best.e.id)
      out[i] = { status: 'possible_duplicate', matchId: best.e.id }
    }
  })
  return out
}
