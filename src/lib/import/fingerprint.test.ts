import { describe, it, expect } from 'vitest'
import { normaliseDescription, assignFingerprints, descriptionSimilarity, cyrb53, fingerprint, fingerprintKey } from './fingerprint'

describe('normaliseDescription', () => {
  it('strips value dates, card numbers and punctuation', () => {
    expect(normaliseDescription('Woolworths 1234 Perth AU Card xx1234 Value Date: 27/10/2026'))
      .toBe('WOOLWORTHS 1234 PERTH AU')
    expect(normaliseDescription('  SQ *Cafe  Nero ')).toBe('SQ CAFE NERO')
  })
})

describe('fingerprints', () => {
  const coffee = { date: '2026-10-27', amount_cents: -500, description: 'SQ *CAFE NERO' }
  it('is deterministic and versioned', () => {
    expect(fingerprint(fingerprintKey(coffee), 0)).toBe(fingerprint(fingerprintKey(coffee), 0))
    expect(fingerprint('x', 0)).toMatch(/^v1:[0-9a-f]{28}$/)
    expect(cyrb53('a')).not.toBe(cyrb53('b'))
  })
  it('gives identical same-day rows different fingerprints', () => {
    const [a, b] = assignFingerprints([coffee, coffee])
    expect(a).not.toBe(b)
  })
  it('reproduces the same fingerprints on an overlapping re-export', () => {
    const lunch = { date: '2026-10-28', amount_cents: -1500, description: 'Lunch' }
    const first = assignFingerprints([lunch, coffee, coffee])
    const again = assignFingerprints([coffee, coffee])
    expect(again).toEqual(first.slice(1))
  })
  it('ignores value-date / card noise so pending→posted text still matches', () => {
    const a = assignFingerprints([{ ...coffee, description: 'SQ *CAFE NERO Card xx1234 Value Date: 26/10/2026' }])
    const b = assignFingerprints([{ ...coffee, description: 'SQ *CAFE NERO' }])
    expect(a).toEqual(b)
  })
  it('changes with amount or date', () => {
    const [base] = assignFingerprints([coffee])
    expect(assignFingerprints([{ ...coffee, amount_cents: -501 }])[0]).not.toBe(base)
    expect(assignFingerprints([{ ...coffee, date: '2026-10-28' }])[0]).not.toBe(base)
  })
})

describe('descriptionSimilarity', () => {
  it('scores identical merchants high regardless of refs', () => {
    expect(descriptionSimilarity('WOOLWORTHS 1234 PERTH', 'Woolworths 9876 Perth')).toBe(1)
  })
  it('scores different merchants low', () => {
    expect(descriptionSimilarity('WOOLWORTHS PERTH', 'NETFLIX.COM')).toBe(0)
  })
  it('treats two empty descriptions as identical', () => {
    expect(descriptionSimilarity('123', '456')).toBe(1)
  })
})
