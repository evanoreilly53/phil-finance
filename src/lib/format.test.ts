import { describe, it, expect } from 'vitest'
import { fmtAUD, fmtCompact, fmtEUR, addMonths, monthKey, monthLabel, signedDelta } from './format'

describe('money formatting (integer cents)', () => {
  it('fmtAUD', () => {
    expect(fmtAUD(123456)).toBe('$1,235')
    expect(fmtAUD(123456, { full: true })).toBe('$1,234.56')
    expect(fmtAUD(-500, { signed: true, full: true })).toBe('-$5.00')
    expect(fmtAUD(500, { signed: true })).toBe('+$5')
  })
  it('fmtCompact', () => {
    expect(fmtCompact(25_000_000)).toBe('$250k')
    expect(fmtCompact(150_000_000)).toBe('$1.50M')
    expect(fmtCompact(-9900)).toBe('$99')
  })
  it('fmtEUR', () => {
    expect(fmtEUR(123456)).toBe('€1,234.56')
  })
  it('signedDelta', () => {
    expect(signedDelta(-250)).toEqual({ sign: '-', text: '$3', isPositive: false })
  })
})

describe('month keys', () => {
  it('addMonths crosses year boundaries both ways', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-03', -14)).toBe('2025-01')
  })
  it('monthKey / monthLabel', () => {
    expect(monthKey('2026-07-31')).toBe('2026-07')
    expect(monthLabel('')).toBe('—')
    expect(monthLabel('2026-07', { month: 'short' })).toBe('Jul')
  })
})
