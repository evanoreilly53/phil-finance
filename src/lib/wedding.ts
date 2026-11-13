// Wedding archive state. Pure.
// The wedding is archived (read-only "Our Wedding 2026" under More › Archive)
// once every item is paid or cancelled, or when you press Archive. Reopening
// sets keep_open on the event so a fully paid wedding stays editable until
// you archive it again. The event always stays as a pin on the Future timeline.

export type WeddingItemLike = {
  status: 'pending' | 'deposit_paid' | 'paid' | 'cancelled' | null
  budget_aud_cents: number | null
  spent_aud_cents: number | null
  budget_eur_cents?: number | null
  spent_eur_cents?: number | null
  balance_owed_eur_cents?: number | null
}

export type WeddingEventLike = { is_archived: boolean; params: unknown } | null

export type WeddingArchiveState = {
  openItems: number
  allPaid: boolean
  archived: boolean
  /** Why it's archived: 'all_paid' (automatic) or 'pressed' (the Archive button). */
  reason: 'all_paid' | 'pressed' | null
  canArchive: boolean
  totals: { budgetAudCents: number; spentAudCents: number; spentEurCents: number; owedEurCents: number; items: number }
}

const keepOpen = (params: unknown) => !!params && typeof params === 'object' && !Array.isArray(params) && (params as Record<string, unknown>).keep_open === true

export function weddingArchiveState(items: readonly WeddingItemLike[], event: WeddingEventLike): WeddingArchiveState {
  const live = items.filter(i => i.status !== 'cancelled')
  const openItems = live.filter(i => i.status !== 'paid').length
  const allPaid = items.length > 0 && openItems === 0
  const pressed = !!event?.is_archived
  const auto = allPaid && !keepOpen(event?.params)
  return {
    openItems,
    allPaid,
    archived: pressed || auto,
    reason: pressed ? 'pressed' : auto ? 'all_paid' : null,
    canArchive: !pressed,
    totals: {
      budgetAudCents: live.reduce((s, i) => s + (i.budget_aud_cents ?? 0), 0),
      spentAudCents: live.reduce((s, i) => s + (i.spent_aud_cents ?? 0), 0),
      spentEurCents: live.reduce((s, i) => s + (i.spent_eur_cents ?? 0), 0),
      owedEurCents: live.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.balance_owed_eur_cents ?? 0), 0),
      items: live.length,
    },
  }
}

/** life_events update for Archive / Reopen. */
export function archiveUpdate(params: unknown, archive: boolean): { is_archived: boolean; params: Record<string, unknown> } {
  const p = params && typeof params === 'object' && !Array.isArray(params) ? { ...(params as Record<string, unknown>) } : {}
  if (archive) delete p.keep_open
  else p.keep_open = true
  return { is_archived: archive, params: p }
}
