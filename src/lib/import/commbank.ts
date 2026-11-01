// CommBank (NetBank) CSV export profile. Pure: no React, no Supabase.
//
// The NetBank "Export → CSV" file is per account and has NO header row:
//
//   "29/10/2026","-45.50","WOOLWORTHS 1234 PERTH AU Card xx1234 Value Date: 27/10/2026","+1,234.56"
//   "28/10/2026","+2,500.00","Salary ACME PTY LTD","+1,280.06"
//
// Columns: Date (DD/MM/YYYY) · Amount (signed, "+"/"-") · Description · Balance
// (running balance after the row, signed; negative on a credit card that's owed).
// Rows are newest first. Some exports omit the balance column, and some newer
// ones add a "Date,Amount,Description,Balance" header; both are handled. Any
// extra trailing columns are ignored.

import { parseAmountCents, parseImportDate } from '../csvImport'

export type BankRow = {
  /** 1-based line in the file, for error messages */
  line: number
  date: string
  amount_cents: number
  description: string
  balance_cents: number | null
}

export type BankParseResult = {
  rows: BankRow[]
  errors: { line: number; message: string }[]
  hadHeader: boolean
}

const HEADER_NAMES = { date: /^date$/i, amount: /^amount$/i, description: /^(description|transaction details|details|narrative)$/i, balance: /^balance$/i }

function isHeader(rec: string[]): boolean {
  return rec.length > 0 && parseImportDate(rec[0] ?? '') === null && rec.some(c => /^date$/i.test(c.trim()))
}

function looksLikeDataRow(rec: string[]): boolean {
  if (rec.length < 3) return false
  return parseImportDate(rec[0]) !== null && parseAmountCents(rec[1]) !== null && rec[2].trim() !== ''
}

/** True when the records look like a CommBank export (with or without header). */
export function looksLikeCommBank(records: string[][]): boolean {
  if (records.length === 0) return false
  const first = isHeader(records[0]) ? records[1] : records[0]
  if (!first) return false
  // DD/MM/YYYY specifically; ISO dates point at some other bank/app
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(first[0]?.trim() ?? '') && looksLikeDataRow(first)
}

export function parseCommBank(records: string[][]): BankParseResult {
  const errors: BankParseResult['errors'] = []
  const rows: BankRow[] = []
  if (records.length === 0) return { rows, errors, hadHeader: false }

  let idx = { date: 0, amount: 1, description: 2, balance: 3 as number | -1 }
  const hadHeader = isHeader(records[0])
  if (hadHeader) {
    const h = records[0].map(c => c.trim())
    const find = (re: RegExp) => h.findIndex(c => re.test(c))
    idx = {
      date: find(HEADER_NAMES.date),
      amount: find(HEADER_NAMES.amount),
      description: find(HEADER_NAMES.description),
      balance: find(HEADER_NAMES.balance),
    }
    if (idx.date < 0 || idx.amount < 0 || idx.description < 0) {
      return { rows, errors: [{ line: 1, message: 'Header row is missing Date, Amount or Description' }], hadHeader }
    }
  }

  const start = hadHeader ? 1 : 0
  for (let i = start; i < records.length; i++) {
    const rec = records[i]
    const line = i + 1
    const rawDate = rec[idx.date] ?? ''
    const date = parseImportDate(rawDate)
    const amount = parseAmountCents(rec[idx.amount] ?? '')
    const description = (rec[idx.description] ?? '').replace(/\s+/g, ' ').trim()
    const balRaw = idx.balance >= 0 ? (rec[idx.balance] ?? '').trim() : ''
    const balance = balRaw === '' ? null : parseAmountCents(balRaw)

    const problems: string[] = []
    if (!date) problems.push(`unrecognised date "${rawDate}"`)
    if (amount === null) problems.push(`bad amount "${rec[idx.amount] ?? ''}"`)
    if (!description) problems.push('no description')
    if (balRaw !== '' && balance === null) problems.push(`bad balance "${balRaw}"`)
    if (problems.length) { errors.push({ line, message: problems.join(', ') }); continue }

    rows.push({ line, date: date!, amount_cents: amount!, description, balance_cents: balance })
  }
  return { rows, errors, hadHeader }
}

/**
 * The account's closing balance according to the file: the running balance
 * on the most recent row. File order is inferred from the balance chain
 * (newest-first files satisfy balance[i] - amount[i] = balance[i+1]), falling
 * back to the dates. Returns null when there is no usable balance column or
 * the chain doesn't add up (so we never write a wrong snapshot).
 */
export function closingBalance(rows: readonly Pick<BankRow, 'date' | 'amount_cents' | 'balance_cents'>[]):
  { date: string; balance_cents: number } | null {
  const withBal = rows.filter(r => r.balance_cents !== null)
  if (withBal.length === 0 || withBal.length !== rows.length) return null
  if (rows.length === 1) return { date: rows[0].date, balance_cents: rows[0].balance_cents! }

  let desc = 0, asc = 0
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1]
    if (a.balance_cents! - a.amount_cents === b.balance_cents) desc++
    if (b.balance_cents! - b.amount_cents === a.balance_cents) asc++
  }
  const pairs = rows.length - 1
  let newestFirst: boolean
  if (desc === pairs && asc < pairs) newestFirst = true
  else if (asc === pairs && desc < pairs) newestFirst = false
  else if (desc === pairs && asc === pairs) newestFirst = rows[0].date >= rows[rows.length - 1].date // all-zero amounts
  else return null // chain broken: missing rows or not a running balance

  const latest = newestFirst ? rows[0] : rows[rows.length - 1]
  const maxDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date)
  if (latest.date !== maxDate) return null
  return { date: latest.date, balance_cents: latest.balance_cents! }
}
