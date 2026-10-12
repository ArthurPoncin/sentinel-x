import { describe, expect, it } from 'vitest'
import { readEnabled as readHands } from '@/features/gestures/utils/enabled'
import { readEnabled, writeEnabled } from './enabled'

// A browser's storage, in memory.
function storage() {
  const kept = new Map<string, string>()
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  }
}

describe('the voice control switch', () => {
  it('is off until the Operator switches it on', () => {
    expect(readEnabled(storage())).toBe(false)
  })

  it('is remembered by the browser, on and off', () => {
    const browser = storage()

    writeEnabled(browser, true)
    expect(readEnabled(browser)).toBe(true)
    writeEnabled(browser, false)
    expect(readEnabled(browser)).toBe(false)
  })

  it('is its own: the hand control stays as it was', () => {
    const browser = storage()

    writeEnabled(browser, true)

    expect(readHands(browser)).toBe(false)
  })

  it('is off in a browser that keeps nothing', () => {
    const closed = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }

    expect(() => writeEnabled(closed, true)).not.toThrow()
    expect(readEnabled(closed)).toBe(false)
  })
})
