import { describe, it, expect } from 'vitest'
import { parseCsvRecords } from '../csvImport'
import { looksLikeCommBank, parseCommBank, closingBalance } from './commbank'

// Shaped like a real NetBank export: no header, quoted, newest first, signed
// amount and running balance, CRLF line endings.
const SAMPLE = [
  '"29/10/2026","-45.50","WOOLWORTHS 1234 PERTH AU Card xx1234 Value Date: 27/10/2026","+1234.56"',
  '"28/10/2026","+2,500.00","Salary ACME PTY LTD","+1280.06"',
  '"28/10/2026","-1,000.00","Transfer to xx4821 NetBank Savings","-1219.94"',
  '"27/10/2026","-5.00","SQ *CAFE NERO PERTH AU","-219.94"',
  '"27/10/2026","-5.00","SQ *CAFE NERO PERTH AU","-214.94"',
].join('\r\n') + '\r\n'

describe('looksLikeCommBank', () => {
  it('recognises a headerless NetBank export', () => {
    expect(looksLikeCommBank(parseCsvRecords(SAMPLE))).toBe(true)
  })
  it('recognises the header variant', () => {
    expect(looksLikeCommBank(parseCsvRecords('Date,Amount,Description,Balance\n01/11/2026,-1.00,X,+5.00'))).toBe(true)
  })
  it('rejects our own generic format (ISO dates, header)', () => {
    expect(looksLikeCommBank(parseCsvRecords('Date,Description,Amount\n2026-11-01,Coffee,-5'))).toBe(false)
  })
  it('rejects an empty file', () => {
    expect(looksLikeCommBank([])).toBe(false)
  })
})

describe('parseCommBank', () => {
  it('parses dates day-first, signed amounts with separators, and balances', () => {
    const { rows, errors, hadHeader } = parseCommBank(parseCsvRecords(SAMPLE))
    expect(errors).toEqual([])
    expect(hadHeader).toBe(false)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({
      line: 1, date: '2026-10-29', amount_cents: -4550,
      description: 'WOOLWORTHS 1234 PERTH AU Card xx1234 Value Date: 27/10/2026', balance_cents: 123456,
    })
    expect(rows[1].amount_cents).toBe(250000)
    expect(rows[2].balance_cents).toBe(-121994)
  })
  it('handles a 3-column export without balance', () => {
    const { rows } = parseCommBank(parseCsvRecords('"01/11/2026","-12.00","Coles"'))
    expect(rows[0].balance_cents).toBeNull()
  })
  it('maps columns from a header row in any order', () => {
    const { rows, hadHeader } = parseCommBank(parseCsvRecords('Description,Date,Balance,Amount\nCoffee,03/11/2026,+10.00,-4.50'))
    expect(hadHeader).toBe(true)
    expect(rows[0]).toMatchObject({ date: '2026-11-03', amount_cents: -450, balance_cents: 1000, description: 'Coffee' })
  })
  it('reports bad rows by line and keeps the good ones', () => {
    const { rows, errors } = parseCommBank(parseCsvRecords('"31/02/2026","-1.00","Bad date","+1"\n"01/03/2026","abc","Bad amt","+1"\n"02/03/2026","-1.00","OK","+1"'))
    expect(rows).toHaveLength(1)
    expect(errors.map(e => e.line)).toEqual([1, 2])
    expect(errors[0].message).toMatch(/date/)
  })
  it('never swaps day and month (04/03 is 4 March)', () => {
    expect(parseCommBank([['04/03/2026', '-1', 'x']]).rows[0].date).toBe('2026-03-04')
  })
})

describe('closingBalance', () => {
  it('takes the newest row of a newest-first file', () => {
    const { rows } = parseCommBank(parseCsvRecords(SAMPLE))
    expect(closingBalance(rows)).toEqual({ date: '2026-10-29', balance_cents: 123456 })
  })
  it('handles an oldest-first file', () => {
    const { rows } = parseCommBank(parseCsvRecords(SAMPLE))
    expect(closingBalance([...rows].reverse())).toEqual({ date: '2026-10-29', balance_cents: 123456 })
  })
  it('returns null when the running balance does not chain (missing rows)', () => {
    const { rows } = parseCommBank(parseCsvRecords(SAMPLE))
    expect(closingBalance([rows[0], rows[3]])).toBeNull()
  })
  it('returns null without a balance column', () => {
    expect(closingBalance([{ date: '2026-01-01', amount_cents: 1, balance_cents: null }])).toBeNull()
  })
  it('accepts a single row', () => {
    expect(closingBalance([{ date: '2026-01-01', amount_cents: -1, balance_cents: 99 }])).toEqual({ date: '2026-01-01', balance_cents: 99 })
  })
})
