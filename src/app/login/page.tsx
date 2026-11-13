'use client'

import { useActionState, useEffect, useState } from 'react'
import { login, type LoginState } from './actions'

const SLOW_HINT_MS = 20_000

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, { status: 'idle' } as LoginState)
  const [slow, setSlow] = useState(false)

  // After a successful sign-in, do a full-page navigation rather than calling
  // redirect() in the action. redirect() from a Server Action makes the server
  // render /dashboard (Home, our heaviest page) inside the action response and
  // keeps the button "pending" until that client-side transition commits; if
  // that render is slow or stalls, the button spins forever. A hard navigation
  // sends the freshly-set session cookies on a normal GET (through the proxy),
  // and Home's loading.tsx / error.tsx then handle slowness and failures.
  const signedIn = state.status === 'ok'
  useEffect(() => {
    if (state.status === 'ok') window.location.assign(state.to)
  }, [state])

  // Belt and braces: if the request itself stalls (network), say so.
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setSlow(true), SLOW_HINT_MS)
    return () => {
      clearTimeout(t)
      setSlow(false)
    }
  }, [pending])

  const error = state.status === 'error' ? state.message : ''

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Bun & Chump" className="w-28 h-28 mx-auto mb-4 rounded-2xl object-contain" />
          <h1 className="text-3xl font-bold text-white">Bun & Chump</h1>
          <p className="text-gray-400 mt-2 text-sm">Household HQ</p>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && !pending && (
            <p role="alert" className="text-red-400 text-sm text-center">{error}</p>
          )}

          {pending && slow && (
            <p role="status" className="text-gray-400 text-sm text-center">
              Still working… If nothing happens, reload the page and try again.
            </p>
          )}

          <button
            type="submit"
            disabled={pending || signedIn}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {pending ? 'Signing in…' : signedIn ? 'Opening Home…' : 'Sign in'}
          </button>

          {signedIn && (
            <p role="status" className="text-gray-400 text-sm text-center">
              Signed in. <a href={state.to} className="text-indigo-400 underline">Open Home</a> if it doesn&apos;t load.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
