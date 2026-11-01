import { describe, it, expect } from 'vitest'
import { fetchAll } from './fetchAll'

function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }))
  const calls: [number, number][] = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  }
  return { page, calls }
}

describe('fetchAll', () => {
  it('pages past the 1,000-row cap and returns every row', async () => {
    const { page, calls } = fakeTable(2_345)
    const out = await fetchAll(page)
    expect(out).toHaveLength(2_345)
    expect(out[2_344]).toEqual({ id: 2_344 })
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
  it('does one extra request when the total is an exact multiple of the page size', async () => {
    const { page, calls } = fakeTable(20)
    expect(await fetchAll(page, 10)).toHaveLength(20)
    expect(calls).toHaveLength(3)
  })
  it('handles empty tables and null data', async () => {
    expect(await fetchAll(async () => ({ data: null, error: null }))).toEqual([])
  })
  it('throws rather than returning a partial result', async () => {
    let n = 0
    const page = async () => (n++ === 0
      ? { data: Array.from({ length: 10 }, () => ({})), error: null }
      : { data: null, error: { message: 'boom' } })
    await expect(fetchAll(page, 10)).rejects.toThrow(/boom/)
  })
})
