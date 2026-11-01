import { describe, it, expect } from 'vitest'
import { sectionFor, activeTrackTab, PAGE_TITLES } from './nav'

describe('nav map', () => {
  it('puts every existing page under a section (no URL changed)', () => {
    expect(sectionFor('/dashboard')).toBe('home')
    for (const p of ['/spending', '/income', '/transactions', '/transactions/import', '/transactions/review', '/networth', '/track/accounts']) {
      expect(sectionFor(p)).toBe('track')
    }
    expect(sectionFor('/goals')).toBe('future')
    expect(sectionFor('/future')).toBe('future')
    expect(sectionFor('/house')).toBe('house')
    for (const p of ['/more', '/more/budgets', '/settings', '/wedding', '/insights']) expect(sectionFor(p)).toBe('more')
  })
  it('does not match on a bare prefix', () => {
    expect(sectionFor('/housework')).toBeNull()
    expect(sectionFor('/login')).toBeNull()
  })
  it('picks the Track sub-tab', () => {
    expect(activeTrackTab('/transactions/review')).toBe('/transactions')
    expect(activeTrackTab('/networth')).toBe('/track/accounts')
    expect(activeTrackTab('/dashboard')).toBeNull()
  })
  it('has a title for every routed page', () => {
    expect(PAGE_TITLES['/wedding']).toBe('Our Wedding 2026')
    expect(PAGE_TITLES['/transactions/review']).toBe('Review')
  })
})
