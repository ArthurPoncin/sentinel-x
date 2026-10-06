import { describe, expect, it } from 'vitest'
import { loginOutcome } from './auth-client'

describe('loginOutcome', () => {
  it('lets the Operator in on 204', () => {
    expect(loginOutcome(204)).toBe('ok')
  })

  it('tells a wrong password from a throttled one', () => {
    expect(loginOutcome(401)).toBe('wrong-password')
    expect(loginOutcome(429)).toBe('throttled')
  })

  it('treats anything else as the Command Post being out of reach', () => {
    expect(loginOutcome(502)).toBe('unreachable')
  })
})
