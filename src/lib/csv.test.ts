import { describe, it, expect } from 'vitest'
import { csvSafe } from './csv'

describe('csvSafe', () => {
  it('neutralises formula-injection prefixes', () => {
    for (const v of ['=SUM(A1)', '+1', '-1', '@x', '\tx']) expect(csvSafe(v)).toBe("'" + v)
  })
  it('leaves normal text alone', () => {
    expect(csvSafe('Coles')).toBe('Coles')
  })
})
