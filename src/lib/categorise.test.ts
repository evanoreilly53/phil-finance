import { describe, it, expect } from 'vitest'
import { matchCategory } from './categorise'

const rule = (pattern: string, category_id: string, priority = 0, owner: string | null = null, is_active = true) =>
  ({ pattern, category_id, priority, owner, is_active })

describe('matchCategory', () => {
  it('matches case-insensitively', () => {
    expect(matchCategory('WOOLWORTHS 1234', 'joint', [rule('woolworths', 'groc')])).toBe('groc')
  })
  it('prefers higher priority', () => {
    expect(matchCategory('uber eats', 'joint', [rule('uber', 'transport', 1), rule('uber eats', 'takeaway', 5)])).toBe('takeaway')
  })
  it('respects owner-specific rules and inactive rules', () => {
    const rules = [rule('gym', 'evan-gym', 0, 'evan'), rule('netflix', 'subs', 0, null, false)]
    expect(matchCategory('Gym', 'rachel', rules)).toBeNull()
    expect(matchCategory('Gym', 'evan', rules)).toBe('evan-gym')
    expect(matchCategory('Netflix', 'evan', rules)).toBeNull()
  })
  it('skips malformed regex instead of throwing', () => {
    expect(matchCategory('coffee', 'joint', [rule('(', 'bad', 9), rule('coffee', 'cafe')])).toBe('cafe')
  })
})
