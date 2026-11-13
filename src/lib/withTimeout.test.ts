import { describe, it, expect, vi, afterEach } from 'vitest'
import { withTimeout, TimeoutError } from './withTimeout'

afterEach(() => { vi.useRealTimers() })

describe('withTimeout', () => {
  it('passes through a value that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42)
  })

  it('passes through a rejection that arrives in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom')
  })

  it('rejects with TimeoutError when the promise never settles', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise(() => {}), 15_000, 'Sign-in')
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })
})
