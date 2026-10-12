import { describe, expect, it } from 'vitest'
import { failureOf } from './vosk-ear'

describe('failureOf', () => {
  it('tells a microphone that was refused from one that is not there, and from one that cannot be read', () => {
    expect(failureOf(new DOMException('', 'NotAllowedError'))).toBe('refused')
    expect(failureOf(new DOMException('', 'SecurityError'))).toBe('refused')
    expect(failureOf(new DOMException('', 'NotFoundError'))).toBe('no-microphone')
    expect(failureOf(new DOMException('', 'OverconstrainedError'))).toBe('no-microphone')
    // Held by another application, or refused by the system: there is one.
    expect(failureOf(new DOMException('', 'NotReadableError'))).toBe('unavailable')
    expect(failureOf(new DOMException('', 'AbortError'))).toBe('unavailable')
    expect(failureOf(new Error('anything else'))).toBe('unavailable')
  })
})
