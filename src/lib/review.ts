// Review-queue helpers. Pure.

import { normaliseDescription } from './import/fingerprint'
import type { ReviewFlag } from './supabase/database.types'

export type ReviewReason = ReviewFlag | 'uncategorised'

export const REVIEW_LABEL: Record<ReviewReason, string> = {
  uncategorised: 'Needs a category',
  suspected_transfer: 'Transfer between your accounts?',
  suspected_duplicate: 'Possible duplicate',
}

/** Why a row is in the queue. Uncategorised is computed, never stored. */
export function reviewReasons(t: { review_flags: readonly ReviewFlag[]; category_id: string | null; is_transfer: boolean }): ReviewReason[] {
  const out: ReviewReason[] = [...t.review_flags]
  if (!t.category_id && !t.is_transfer && !out.includes('suspected_transfer')) out.push('uncategorised')
  return out
}

// Generic words banks put in front of the merchant name
const NOISE = new Set([
  'POS', 'EFTPOS', 'VISA', 'MASTERCARD', 'PURCHASE', 'DEBIT', 'CREDIT', 'DIRECT', 'CARD', 'PAYMENT',
  'SQ', 'SP', 'PAYPAL', 'IAP', 'TAP', 'AND', 'PAY', 'APPLE', 'GOOGLE', 'INT', 'INTL', 'WWW', 'COM', 'AU',
])

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A rule pattern that will match this merchant again: the first one or two
 * meaningful words, regex-escaped. "WOOLWORTHS 1234 PERTH AU Card xx1234" →
 * "WOOLWORTHS". Returns null when nothing usable is left.
 */
export function suggestRulePattern(description: string): string | null {
  const words = normaliseDescription(description)
    .split(' ')
    .filter(w => /^[A-Z][A-Z&']*$/.test(w) && w.length >= 3 && !NOISE.has(w))
  if (words.length === 0) return null
  const pick = words[0].length >= 6 ? [words[0]] : words.slice(0, 2)
  return pick.map(escapeRe).join('\\s+')
}
