import { describe, it, expect } from 'vitest'
import {
  parseCsv, parseAmountCents, parseImportDate, toAudCents, parseRate, resolveImportRow,
} from './csvImport'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const text = '﻿Date,Description,Amount\r\n2026-01-02,"Coles, Perth",-12.50\r\n2026-01-03,"He said ""hi""\nline2",5\r\n\r\n'
    const { headers, rows } = parseCsv(text)
    expect(headers).toEqual(['Date', 'Description', 'Amount'])
    expect(rows).toEqual([
      ['2026-01-02', 'Coles, Perth', '-12.50'],
      ['2026-01-03', 'He said "hi"\nline2', '5'],
    ])
  })
  it('handles a file without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([['1', '2']])
  })
  it('returns empty for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('parseAmountCents', () => {
  it('parses without float drift', () => {
    expect(parseAmountCents('1.005')).toBe(101)   // Math.round(1.005*100) gives 100
    expect(parseAmountCents('19.99')).toBe(1999)
    expect(parseAmountCents('-0.1')).toBe(-10)
  })
  it('handles symbols, thousands separators, signs and accounting negatives', () => {
    expect(parseAmountCents('$1,234.50')).toBe(123450)
    expect(parseAmountCents('-€20')).toBe(-2000)
    expect(parseAmountCents('(12.34)')).toBe(-1234)
    expect(parseAmountCents('+7')).toBe(700)
    expect(parseAmountCents('.5')).toBe(50)
  })
  it('rejects junk', () => {
    expect(parseAmountCents('')).toBeNull()
    expect(parseAmountCents('abc')).toBeNull()
    expect(parseAmountCents('1.2.3')).toBeNull()
    expect(parseAmountCents('-')).toBeNull()
  })
})

describe('parseImportDate', () => {
  it('keeps ISO dates', () => {
    expect(parseImportDate('2026-03-04')).toBe('2026-03-04')
    expect(parseImportDate('2026-3-4')).toBe('2026-03-04')
  })
  it('reads slash dates day-first (AU/IE), never month-first', () => {
    expect(parseImportDate('04/03/2026')).toBe('2026-03-04')
    expect(parseImportDate('4/3/26')).toBe('2026-03-04')
    expect(parseImportDate('31.12.2025')).toBe('2025-12-31')
  })
  it('rejects impossible or unknown formats instead of letting Postgres guess', () => {
    expect(parseImportDate('13/13/2026')).toBeNull()
    expect(parseImportDate('31/02/2026')).toBeNull()
    expect(parseImportDate('29/02/2028')).toBe('2028-02-29')
    expect(parseImportDate('March 4 2026')).toBeNull()
    expect(parseImportDate('')).toBeNull()
  })
})

describe('toAudCents / parseRate', () => {
  it('AUD passes through at rate 1', () => {
    expect(toAudCents(-1234, 'AUD', undefined)).toEqual({ aud_amount_cents: -1234, fx_rate: 1 })
    expect(toAudCents(-1234, 'aud', 2)).toEqual({ aud_amount_cents: -1234, fx_rate: 1 })
  })
  it('converts EUR with the rate (was stored as AUD unconverted)', () => {
    expect(toAudCents(-10000, 'EUR', 1.65)).toEqual({ aud_amount_cents: -16500, fx_rate: 1.65 })
    expect(toAudCents(333, 'EUR', 1.6543)).toEqual({ aud_amount_cents: 551, fx_rate: 1.6543 })
  })
  it('refuses to convert without a valid rate', () => {
    expect(toAudCents(100, 'EUR', null)).toBeNull()
    expect(toAudCents(100, 'EUR', 0)).toBeNull()
    expect(toAudCents(100, 'EUR', Number.NaN)).toBeNull()
  })
  it('parseRate', () => {
    expect(parseRate('1.65')).toBe(1.65)
    expect(parseRate(' ')).toBeNull()
    expect(parseRate('-1')).toBeNull()
    expect(parseRate(undefined)).toBeNull()
  })
})

describe('resolveImportRow', () => {
  const ctx = {
    accounts: [
      { id: 'acc-aud', name: 'Joint Bank', currency: 'AUD' },
      { id: 'acc-eur', name: 'AIB',        currency: 'EUR' },
    ],
    categories: [{ id: 'cat-groc', name: 'Groceries' }],
    rules: [{ pattern: 'tesco', category_id: 'cat-groc', owner: null, priority: 0, is_active: true }],
    defaultRates: { EUR: 1.6 },
  }

  it('converts a EUR row using the account currency and default rate', () => {
    const r = resolveImportRow({ date: '05/01/2026', description: 'Tesco', amount: '-10.00', account: 'aib' }, ctx)
    expect(r.error).toBeUndefined()
    expect(r).toMatchObject({
      date: '2026-01-05', currency: 'EUR', amount_cents: -1000, aud_amount_cents: -1600, fx_rate: 1.6,
      account_id: 'acc-eur', category_id: 'cat-groc', owner: 'joint',
    })
  })
  it('a per-row fx_rate beats the default', () => {
    const r = resolveImportRow({ date: '2026-01-05', description: 'x', amount: '-10', currency: 'EUR', fx_rate: '1.7', account: 'AIB' }, ctx)
    expect(r.aud_amount_cents).toBe(-1700)
  })
  it('flags a foreign row with no rate instead of storing it as AUD', () => {
    const r = resolveImportRow(
      { date: '2026-01-05', description: 'x', amount: '-10', currency: 'GBP', account: 'Joint Bank' },
      { ...ctx, defaultRates: {} },
    )
    expect(r.error).toMatch(/GBP→AUD/)
  })
  it('AUD rows keep amount = aud amount', () => {
    const r = resolveImportRow({ date: '2026-01-05', description: 'Coffee', amount: '-4.50', account: 'Joint Bank', owner: 'Evan', category: 'groceries' }, ctx)
    expect(r).toMatchObject({ currency: 'AUD', amount_cents: -450, aud_amount_cents: -450, fx_rate: 1, owner: 'evan', category_id: 'cat-groc' })
  })
  it('collects validation errors', () => {
    const r = resolveImportRow({ date: '13/13/2026', description: '', amount: 'abc', account: 'Nope' }, ctx)
    expect(r.error).toContain('unknown account')
    expect(r.error).toContain('unrecognised date')
    expect(r.error).toContain('no description')
    expect(r.error).toContain('bad amount')
  })
})
