// Newest first (desc) or oldest first (asc): the order of a time-ordered table.
export type SortOrder = 'desc' | 'asc'

export const PAGE_SIZE = 10

export function flip(order: SortOrder): SortOrder {
  return order === 'desc' ? 'asc' : 'desc'
}

// A list already newest first, in the order asked. Reversed rather than sorted again: rows that share a
// timestamp keep the order they came in.
export function inOrder<T>(newestFirst: readonly T[], order: SortOrder): T[] {
  return order === 'desc' ? [...newestFirst] : newestFirst.toReversed()
}

export interface Page<T> {
  rows: T[]
  // 1-based, clamped to the pages there are.
  page: number
  pages: number
  // 1-based position of the first and last row shown; 0 and 0 on an empty list.
  first: number
  last: number
  total: number
}

// One page of a list. A page past the end (the list shrank under a filter) falls back on the last one.
export function paginate<T>(items: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const current = Math.min(Math.max(1, Math.floor(page)), pages)
  const start = (current - 1) * size
  const rows = items.slice(start, start + size)
  return {
    rows,
    page: current,
    pages,
    first: rows.length === 0 ? 0 : start + 1,
    last: start + rows.length,
    total: items.length,
  }
}
