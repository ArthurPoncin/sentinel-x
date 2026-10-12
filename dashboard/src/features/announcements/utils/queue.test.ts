import { describe, expect, it } from 'vitest'
import { queued, written } from './queue'

describe('queued', () => {
  it('puts the fresh sentences behind those waiting', () => {
    expect(queued(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('never holds more than the limit, however many Alerts burst', () => {
    const burst = Array.from({ length: 40 }, (_, index) => `alert ${index}`)

    expect(queued(['a', 'b'], burst, 3)).toEqual(['alert 0', 'alert 1', 'alert 2'])
  })

  it('drops those that waited longest first, then the least severe of the fresh ones', () => {
    expect(queued(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd'])
    expect(queued(['a', 'b'], ['c', 'd'], 3)).toEqual(['b', 'c', 'd'])
    expect(queued(['a'], ['b', 'c', 'd', 'e'], 3)).toEqual(['b', 'c', 'd'])
  })

  it('keeps what waits when nothing arrives', () => {
    expect(queued(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('written', () => {
  it('writes the fresh sentences under the others, each with a number of its own', () => {
    const lines = written(written([], ['a']), ['a', 'b'])

    expect(lines).toEqual([
      { id: 1, text: 'a' },
      { id: 2, text: 'a' },
      { id: 3, text: 'b' },
    ])
  })

  it('keeps the latest only, and goes on counting', () => {
    const lines = written(written([], ['a', 'b', 'c'], 3), ['d'], 3)

    expect(lines).toEqual([
      { id: 2, text: 'b' },
      { id: 3, text: 'c' },
      { id: 4, text: 'd' },
    ])
  })
})
