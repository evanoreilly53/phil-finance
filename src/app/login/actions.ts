'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import {
  createLoginLimiter, LOGIN_LIMITS, blockedMessage, classifySignInError,
  MSG_INVALID, MSG_UNAVAILABLE, MSG_PROVIDER_RATE_LIMIT,
} from '@/lib/loginRateLimit'
import { withTimeout, TimeoutError } from '@/lib/withTimeout'

export type LoginState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  // Signed in: the session cookies are on this response. The page then does a
  // full-page navigation to Home (see page.tsx for why not redirect()).
  | { status: 'ok'; to: '/dashboard' }

// Per-instance, in-memory limiter. See src/lib/loginRateLimit.ts for the
// Fluid Compute limitation (counts are per server instance, reset on cold start).
const limiter = createLoginLimiter(LOGIN_LIMITS)

const SIGN_IN_TIMEOUT_MS = 15_000

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    if (!email || !password) return { status: 'error', message: 'Enter your email and password.' }

    const gate = limiter.check(ip, email, Date.now())
    if (gate.blocked) return { status: 'error', message: blockedMessage(gate.retryAfterMs) }

    const supabase = await createClient()
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      SIGN_IN_TIMEOUT_MS,
      'Supabase sign-in',
    )

    if (error) {
      const kind = classifySignInError(error)
      if (kind === 'credentials') {
        limiter.recordFailure(ip, email, Date.now())
        // Same message for unknown email and wrong password, on purpose.
        return { status: 'error', message: MSG_INVALID }
      }
      console.error('[login] sign-in service error', { status: error.status, code: error.code })
      return { status: 'error', message: kind === 'provider_rate_limit' ? MSG_PROVIDER_RATE_LIMIT : MSG_UNAVAILABLE }
    }

    limiter.recordSuccess(ip, email)
    return { status: 'ok', to: '/dashboard' }
  } catch (err) {
    // Never leave the button spinning: anything unexpected becomes a message.
    if (err instanceof TimeoutError) {
      console.error('[login] sign-in timed out')
      return { status: 'error', message: 'Signing in is taking too long. Check your connection and try again.' }
    }
    console.error('[login] unexpected error', err)
    return { status: 'error', message: 'Something went wrong signing in. Please try again.' }
  }
}
