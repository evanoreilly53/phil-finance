// Login rate limiter: pure logic, no I/O, so it can be unit-tested with a fake clock.
//
// Only FAILED sign-ins count. A successful sign-in clears the counters for that
// IP and that email. Each key (IP, email) gets a fixed window that starts at its
// first failure; once a key has `limit` failures it is locked until the window ends.
//
// LIMITATION: state lives in the memory of one server instance. On Vercel (Fluid
// Compute) an instance is reused across many requests, so this does slow down
// guessing in practice, but separate instances keep separate counts and a cold
// start or redeploy resets everything. It is a speed bump for a two-person
// household app, not a security boundary; Supabase Auth's own rate limits still
// apply behind it. A shared store (e.g. Redis) would be needed for a strict limit.

export type LimiterOptions = {
  /** Failures allowed per IP within the window. */
  ipLimit: number
  /** Failures allowed per email within the window. */
  emailLimit: number
  windowMs: number
  /** Upper bound on tracked keys, so the map cannot grow without limit. */
  maxKeys?: number
}

export type LimiterCheck = { blocked: false } | { blocked: true; retryAfterMs: number }

type Entry = { failures: number; resetAt: number }

export const LOGIN_LIMITS: LimiterOptions = {
  // Two people share the household's IP, so the IP allowance is a little larger.
  ipLimit: 10,
  emailLimit: 5,
  windowMs: 15 * 60 * 1000,
  maxKeys: 5000,
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function blockedMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

export const MSG_INVALID = 'Invalid email or password'
export const MSG_UNAVAILABLE = "Couldn't reach the sign-in service. Check your connection and try again."
export const MSG_PROVIDER_RATE_LIMIT = 'Too many sign-in attempts right now. Wait a few minutes and try again.'

/**
 * Sort a Supabase sign-in error. Only `credentials` counts towards the lockout;
 * outages and Supabase's own rate limiting must not lock the household out.
 */
export function classifySignInError(err: { status?: number; code?: string }): 'credentials' | 'provider_rate_limit' | 'unavailable' {
  if (err.status === 429 || (err.code && err.code.startsWith('over_') && err.code.endsWith('rate_limit'))) return 'provider_rate_limit'
  if (err.status === undefined || err.status === 0 || err.status >= 500) return 'unavailable'
  return 'credentials'
}

export function createLoginLimiter(opts: LimiterOptions) {
  const entries = new Map<string, Entry>()
  const maxKeys = opts.maxKeys ?? 5000

  const keysFor = (ip: string, email: string) => {
    const keys: { key: string; limit: number }[] = [{ key: `ip:${ip}`, limit: opts.ipLimit }]
    const e = normaliseEmail(email)
    if (e) keys.push({ key: `email:${e}`, limit: opts.emailLimit })
    return keys
  }

  const live = (key: string, now: number): Entry | undefined => {
    const entry = entries.get(key)
    if (entry && now >= entry.resetAt) {
      entries.delete(key)
      return undefined
    }
    return entry
  }

  const prune = (now: number) => {
    for (const [key, entry] of entries) if (now >= entry.resetAt) entries.delete(key)
    // Still too big (a flood of distinct keys): drop the oldest insertions.
    while (entries.size > maxKeys) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    /** Is this IP or email currently locked out? Does not count anything. */
    check(ip: string, email: string, now: number): LimiterCheck {
      let retryAfterMs = 0
      for (const { key, limit } of keysFor(ip, email)) {
        const entry = live(key, now)
        if (entry && entry.failures >= limit) retryAfterMs = Math.max(retryAfterMs, entry.resetAt - now)
      }
      return retryAfterMs > 0 ? { blocked: true, retryAfterMs } : { blocked: false }
    },

    /** Count one failed sign-in against the IP and the email. */
    recordFailure(ip: string, email: string, now: number): void {
      for (const { key } of keysFor(ip, email)) {
        const entry = live(key, now)
        if (entry) entry.failures++
        else entries.set(key, { failures: 1, resetAt: now + opts.windowMs })
      }
      if (entries.size > maxKeys) prune(now)
    },

    /** A successful sign-in clears both counters. */
    recordSuccess(ip: string, email: string): void {
      for (const { key } of keysFor(ip, email)) entries.delete(key)
    },

    /** For tests. */
    size(): number {
      return entries.size
    },
  }
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>
