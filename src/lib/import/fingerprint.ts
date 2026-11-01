// Stable import fingerprints + description similarity. Pure.
//
// CommBank CSVs carry no transaction id, so a row's identity is
//   date | signed amount | normalised description | occurrence #
// where "occurrence #" counts identical (date, amount, description) rows in the
// same file. Two $5 coffees on one day get #0 and #1; re-importing an
// overlapping export reproduces the same numbers, so both are recognised.
// The fingerprint is stored in transactions.external_id, unique per account.

/** Uppercase, strip CommBank noise (value dates, card numbers, refs), collapse spaces. */
export function normaliseDescription(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/VALUE DATE:?\s*\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ')
    .replace(/\bCARD\s+X+\d{2,4}\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** cyrb53: small, fast, well-distributed 53-bit string hash (public domain). */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export const FINGERPRINT_VERSION = 'v1'

export function fingerprintKey(r: { date: string; amount_cents: number; description: string }): string {
  return `${r.date}|${r.amount_cents}|${normaliseDescription(r.description)}`
}

/** ~106-bit fingerprint for a key + occurrence number. */
export function fingerprint(key: string, occurrence: number): string {
  const s = `${key}#${occurrence}`
  return `${FINGERPRINT_VERSION}:${cyrb53(s, 1).toString(16).padStart(14, '0')}${cyrb53(s, 2).toString(16).padStart(14, '0')}`
}

/** Fingerprints for every row of ONE account's file, in input order. */
export function assignFingerprints(rows: readonly { date: string; amount_cents: number; description: string }[]): string[] {
  const seen = new Map<string, number>()
  return rows.map(r => {
    const key = fingerprintKey(r)
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return fingerprint(key, n)
  })
}

function tokens(desc: string): Set<string> {
  // letters only: reference numbers and dates differ between pending/posted rows
  return new Set(normaliseDescription(desc).split(' ').map(t => t.replace(/[0-9]/g, '')).filter(t => t.length >= 2))
}

/** Dice coefficient over word tokens, 0..1. Two empty descriptions count as identical. */
export function descriptionSimilarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b)
  if (A.size === 0 && B.size === 0) return 1
  if (A.size === 0 || B.size === 0) return 0
  let common = 0
  for (const t of A) if (B.has(t)) common++
  return (2 * common) / (A.size + B.size)
}
