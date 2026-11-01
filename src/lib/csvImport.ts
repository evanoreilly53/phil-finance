// Pure helpers for the CSV transaction importer. No React, no Supabase.

import { matchCategory } from './categorise'

// ── CSV parsing ──────────────────────────────────────────────────────────────

/**
 * RFC-4180-ish parser: quoted fields, escaped quotes (""), commas and newlines
 * inside quotes, CRLF/CR line endings and a leading UTF-8 BOM. Cells are trimmed.
 * Blank lines are dropped.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const nonBlank = parseCsvRecords(text)
  return { headers: nonBlank[0] ?? [], rows: nonBlank.slice(1) }
}

/** All non-blank records, without treating the first as a header (CommBank exports have none). */
export function parseCsvRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQ = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ }
        else inQ = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      records.push(row); row = []
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell.trim()); records.push(row) }

  return records.filter(r => r.some(c => c !== ''))
}

// ── Amounts ──────────────────────────────────────────────────────────────────

/**
 * Parse a money string to integer cents without floating-point drift.
 * Accepts "-12.34", "1,234.50", "$12", "(12.34)" (accounting negative), "12.345" (rounded half-up).
 * Returns null if it isn't a number.
 */
export function parseAmountCents(raw: string): number | null {
  let s = raw.trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  s = s.replace(/[\s$€£,]|AUD|EUR|USD|GBP/gi, '')
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1) }
  else if (s.startsWith('+')) s = s.slice(1)
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null
  const whole = m[1] === '' ? 0 : parseInt(m[1], 10)
  const frac  = (m[2] ?? '').padEnd(3, '0')
  let cents = whole * 100 + parseInt(frac.slice(0, 2), 10)
  if (parseInt(frac[2], 10) >= 5) cents += 1
  return negative ? -cents : cents
}

// ── Dates ────────────────────────────────────────────────────────────────────

function validYMD(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= dim
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Normalise a CSV date to YYYY-MM-DD.
 * - ISO `2026-03-04` is taken as-is.
 * - Slash/dash/dot dates are read DAY-FIRST (AU/IE banks): `04/03/2026` → 2026-03-04.
 *   Two-digit years are 20yy.
 * Returns null for anything else or an impossible date, so we never let
 * Postgres guess (its default MDY would silently swap day and month).
 */
export function parseImportDate(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validYMD(y, mo, d) ? iso(y, mo, d) : null
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const d  = Number(m[1])
    const mo = Number(m[2])
    const y  = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return validYMD(y, mo, d) ? iso(y, mo, d) : null
  }
  return null
}

// ── FX ───────────────────────────────────────────────────────────────────────

/**
 * Convert native cents to AUD cents. `rate` is AUD per 1 unit of `currency`
 * (same convention as the Add Transaction modal: aud = native × rate).
 * Returns null when a non-AUD amount has no usable rate.
 */
export function toAudCents(
  nativeCents: number,
  currency: string,
  rate: number | null | undefined,
): { aud_amount_cents: number; fx_rate: number } | null {
  if (currency.toUpperCase() === 'AUD') return { aud_amount_cents: nativeCents, fx_rate: 1 }
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null
  return { aud_amount_cents: Math.round(nativeCents * rate), fx_rate: rate }
}

/** Parse a user-typed rate; null if blank/invalid. */
export function parseRate(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const n = Number(raw.trim())
  return raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

// ── Row resolution ───────────────────────────────────────────────────────────

export const IMPORT_COLS = ['date', 'description', 'amount', 'debit', 'credit', 'balance', 'currency', 'fx_rate', 'owner', 'account', 'category', 'notes'] as const
export type ImportCol = (typeof IMPORT_COLS)[number]
export type ImportOwner = 'joint' | 'rachel' | 'evan'

type Ctx = {
  accounts:   readonly { id: string; name: string; currency: string; owner?: string }[]
  /** When the whole file belongs to one account, rows don't need an Account column. */
  fixedAccountId?: string | null
  categories: readonly { id: string; name: string }[]
  rules:      Parameters<typeof matchCategory>[2]
  /** Fallback AUD-per-unit rate by currency (e.g. { EUR: 1.65 }) when a row has no fx_rate cell. */
  defaultRates: Readonly<Record<string, number | null>>
}

export type ResolvedImportRow = {
  date: string
  description: string
  amountRaw: string
  currency: string
  owner: ImportOwner
  accountName: string
  notes: string
  account_id: string
  category_id: string
  amount_cents: number
  balance_cents: number | null
  aud_amount_cents: number
  fx_rate: number
  error?: string
}

export function resolveImportRow(cells: Partial<Record<ImportCol, string>>, ctx: Ctx): ResolvedImportRow {
  const get = (c: ImportCol) => (cells[c] ?? '').trim()
  const errors: string[] = []

  const fixed = ctx.fixedAccountId ? ctx.accounts.find(a => a.id === ctx.fixedAccountId) : undefined
  const accountName = fixed?.name ?? get('account')
  const account = fixed ?? ctx.accounts.find(a => a.name.toLowerCase() === accountName.toLowerCase())
  if (!account) errors.push(`unknown account "${accountName}"`)

  // Owner: column, else the account's owner, else joint
  const ownerRaw = (get('owner') || account?.owner || '').toLowerCase()
  const owner = (['joint', 'rachel', 'evan'].includes(ownerRaw) ? ownerRaw : 'joint') as ImportOwner

  const rawDate = get('date')
  const date = parseImportDate(rawDate)
  if (!rawDate) errors.push('no date')
  else if (!date) errors.push(`unrecognised date "${rawDate}"`)

  const description = get('description')
  if (!description) errors.push('no description')

  // Either one signed Amount column, or separate Debit / Credit columns
  // (a debit is money out whatever sign the bank printed).
  let amountRaw = get('amount')
  let cents: number | null
  if (amountRaw === '' && (get('debit') !== '' || get('credit') !== '')) {
    const debit  = get('debit')  === '' ? 0 : parseAmountCents(get('debit'))
    const credit = get('credit') === '' ? 0 : parseAmountCents(get('credit'))
    cents = debit === null || credit === null ? null : Math.abs(credit) - Math.abs(debit)
    amountRaw = get('debit') || get('credit')
  } else {
    cents = parseAmountCents(amountRaw)
  }
  if (cents === null) errors.push('bad amount')
  const balanceRaw = get('balance')
  const balance_cents = balanceRaw === '' ? null : parseAmountCents(balanceRaw)

  // Currency: explicit column, else the account's own currency, else AUD
  const currency = (get('currency') || account?.currency || 'AUD').toUpperCase()

  const rowRate = parseRate(get('fx_rate'))
  const fx = toAudCents(cents ?? 0, currency, rowRate ?? ctx.defaultRates[currency] ?? null)
  if (!fx) errors.push(`no ${currency}→AUD rate`)

  const categoryName = get('category')
  const category_id =
    ctx.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase() && categoryName !== '')?.id ??
    matchCategory(description, owner, ctx.rules) ?? ''

  return {
    date: date ?? rawDate,
    description,
    amountRaw,
    currency,
    owner,
    accountName,
    notes: get('notes'),
    account_id: account?.id ?? '',
    category_id,
    amount_cents: cents ?? 0,
    balance_cents,
    aud_amount_cents: fx?.aud_amount_cents ?? 0,
    fx_rate: fx?.fx_rate ?? 0,
    error: errors.length ? errors.join(', ') : undefined,
  }
}
