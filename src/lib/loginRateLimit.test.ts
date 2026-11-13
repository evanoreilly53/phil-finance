import { describe, it, expect } from 'vitest'
import { createLoginLimiter, blockedMessage, normaliseEmail, classifySignInError, LOGIN_LIMITS } from './loginRateLimit'

const MIN = 60_000
const opts = { ipLimit: 10, emailLimit: 5, windowMs: 15 * MIN }

describe('login rate limiter', () => {
  it('allows a fresh IP and email', () => {
    const l = createLoginLimiter(opts)
    expect(l.check('1.1.1.1', 'a@x.com', 0)).toEqual({ blocked: false })
  })

  it('does not count successful sign-ins', () => {
    const l = createLoginLimiter(opts)
    for (let i = 0; i < 50; i++) l.recordSuccess('1.1.1.1', 'a@x.com')
    expect(l.check('1.1.1.1', 'a@x.com', 0).blocked).toBe(false)
  })

  it('blocks an email after 5 failures, with the time left', () => {
    const l = createLoginLimiter(opts)
    for (let i = 0; i < 4; i++) l.recordFailure('1.1.1.1', 'a@x.com', i * MIN)
    expect(l.check('1.1.1.1', 'a@x.com', 4 * MIN).blocked).toBe(false)
    l.recordFailure('1.1.1.1', 'a@x.com', 4 * MIN)
    expect(l.check('1.1.1.1', 'a@x.com', 5 * MIN)).toEqual({ blocked: true, retryAfterMs: 10 * MIN })
  })

  it('email lockout applies from any IP, and is case/space-insensitive', () => {
    const l = createLoginLimiter(opts)
    for (let i = 0; i < 5; i++) l.recordFailure(`10.0.0.${i}`, '  A@X.com ', 0)
    expect(l.check('9.9.9.9', 'a@x.com', 1).blocked).toBe(true)
    // A different email from a fresh IP is unaffected
    expect(l.check('9.9.9.9', 'b@x.com', 1).blocked).toBe(false)
  })

  it('blocks an IP after 10 failures across different emails', () => {
    const l = createLoginLimiter(opts)
    for (let i = 0; i < 9; i++) l.recordFailure('1.1.1.1', `u${i}@x.com`, 0)
    expect(l.check('1.1.1.1', 'new@x.com', 0).blocked).toBe(false)
    l.recordFailure('1.1.1.1', 'u9@x.com', 0)
    expect(l.check('1.1.1.1', 'new@x.com', 0).blocked).toBe(true)
    expect(l.check('2.2.2.2', 'new@x.com', 0).blocked).toBe(false)
  })

  it('unlocks when the window ends', () => {
    const l = createLoginLimiter(opts)
    for (let i = 0; i < 5; i++) l.recordFailure('1.1.1.1', 'a@x.com', 0)
    expect(l.check('1.1.1.1', 'a@x.com', 15 * MIN - 1).blocked).toBe(true)
    expect(l.check('1.1.1.1', 'a@x.com', 15 * MIN).blocked).toBe(false)
    // A failure after expiry starts a new window at 1
    l.recordFailure('1.1.1.1', 'a@x.com', 15 * MIN)
    expect(l.check('1.1.1.1', 'a@x.com', 15 * MIN).blocked).toBe(false)
  })

  it('a success clears earlier failures for that IP and email', () => {
    const l = createLoginLimiter(opts)
    for (let i = 0; i < 4; i++) l.recordFailure('1.1.1.1', 'a@x.com', 0)
    l.recordSuccess('1.1.1.1', 'a@x.com')
    for (let i = 0; i < 4; i++) l.recordFailure('1.1.1.1', 'a@x.com', 0)
    expect(l.check('1.1.1.1', 'a@x.com', 0).blocked).toBe(false)
  })

  it('keeps the map bounded', () => {
    const l = createLoginLimiter({ ...opts, maxKeys: 20 })
    for (let i = 0; i < 100; i++) l.recordFailure(`ip${i}`, '', 0)
    expect(l.size()).toBeLessThanOrEqual(20)
  })

  it('production limits are the documented ones', () => {
    expect(LOGIN_LIMITS).toMatchObject({ ipLimit: 10, emailLimit: 5, windowMs: 15 * MIN })
  })
})

describe('classifySignInError', () => {
  it('wrong password counts as credentials', () => {
    expect(classifySignInError({ status: 400, code: 'invalid_credentials' })).toBe('credentials')
    expect(classifySignInError({ status: 400, code: 'email_not_confirmed' })).toBe('credentials')
  })
  it('Supabase rate limits are not credentials', () => {
    expect(classifySignInError({ status: 429, code: 'over_request_rate_limit' })).toBe('provider_rate_limit')
    expect(classifySignInError({ status: 400, code: 'over_email_send_rate_limit' })).toBe('provider_rate_limit')
  })
  it('outages and network failures are not credentials', () => {
    expect(classifySignInError({ status: 500 })).toBe('unavailable')
    expect(classifySignInError({ status: 503, code: 'unexpected_failure' })).toBe('unavailable')
    expect(classifySignInError({ status: 0 })).toBe('unavailable')
    expect(classifySignInError({})).toBe('unavailable')
  })
})

describe('messages', () => {
  it('rounds the wait up to whole minutes', () => {
    expect(blockedMessage(10 * MIN)).toBe('Too many attempts. Try again in 10 minutes.')
    expect(blockedMessage(61_000)).toBe('Too many attempts. Try again in 2 minutes.')
    expect(blockedMessage(5_000)).toBe('Too many attempts. Try again in 1 minute.')
  })

  it('normalises emails', () => {
    expect(normaliseEmail('  Evan@Example.COM ')).toBe('evan@example.com')
  })
})
