import { describe, it, expect } from 'vitest'
import { isCategoryOrChildOf, resolveParentName } from './categories'

// Mirrors schema.sql: Rent is a CHILD of Housing/Utilities
const housing = { id: 'h', name: 'Housing/Utilities', parent_id: null }
const rent    = { id: 'r', name: 'Rent', parent_id: 'h' }
const power   = { id: 'p', name: 'Electricity', parent_id: 'h' }
const all = [housing, rent, power]

describe('isCategoryOrChildOf (rent-to-income fix)', () => {
  it('matches the Rent child category', () => {
    // The old check compared the PARENT name to 'Rent', which is never true
    expect(resolveParentName('r', rent, all)).toBe('Housing/Utilities')
    expect(isCategoryOrChildOf(rent, all, 'Rent')).toBe(true)
  })
  it('does not match siblings or the parent', () => {
    expect(isCategoryOrChildOf(power, all, 'Rent')).toBe(false)
    expect(isCategoryOrChildOf(housing, all, 'Rent')).toBe(false)
  })
  it('matches children of a top-level category of that name', () => {
    const topRent = { id: 'tr', name: 'Rent', parent_id: null }
    const sub     = { id: 's', name: 'Bond', parent_id: 'tr' }
    expect(isCategoryOrChildOf(sub, [topRent, sub], 'rent')).toBe(true)
  })
  it('handles uncategorised', () => {
    expect(isCategoryOrChildOf(null, all, 'Rent')).toBe(false)
    expect(resolveParentName(null, null, all)).toBe('Uncategorised')
  })
})
