import { describe, expect, it } from 'vitest'
import { flip, inOrder, paginate } from './paging'

const items = Array.from({ length: 23 }, (_, i) => i + 1)

describe('paginate', () => {
  it('cuts the list into pages of ten', () => {
    expect(paginate(items, 1)).toEqual({ rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, pages: 3, first: 1, last: 10, total: 23 })
    expect(paginate(items, 3)).toEqual({ rows: [21, 22, 23], page: 3, pages: 3, first: 21, last: 23, total: 23 })
  })

  it('falls back on the last page past the end, and on the first before it', () => {
    expect(paginate(items, 9).page).toBe(3)
    expect(paginate(items, 0).page).toBe(1)
  })

  it('takes another page size', () => {
    expect(paginate(items, 2, 20).rows).toEqual([21, 22, 23])
  })

  it('gives one empty page for an empty list', () => {
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1, first: 0, last: 0, total: 0 })
  })
})

describe('inOrder', () => {
  it('keeps the newest first, or turns it oldest first', () => {
    expect(inOrder([3, 2, 1], 'desc')).toEqual([3, 2, 1])
    expect(inOrder([3, 2, 1], 'asc')).toEqual([1, 2, 3])
  })

  it('leaves the list it is given untouched', () => {
    const newestFirst = [3, 2, 1]
    inOrder(newestFirst, 'asc')
    expect(newestFirst).toEqual([3, 2, 1])
  })
})

describe('flip', () => {
  it('switches between newest and oldest first', () => {
    expect(flip('desc')).toBe('asc')
    expect(flip('asc')).toBe('desc')
  })
})
