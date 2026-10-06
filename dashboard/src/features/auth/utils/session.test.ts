import { describe, expect, it } from 'vitest'
import { afterCheck } from './session'

describe('afterCheck', () => {
  it('lets the Operator in at load only when the Command Post says there is a session', () => {
    expect(afterCheck('checking', 'open')).toBe('in')
    expect(afterCheck('checking', 'closed')).toBe('out')
    expect(afterCheck('checking', 'unknown')).toBe('out')
  })

  it('sends the Operator back to the login screen once the session is gone', () => {
    expect(afterCheck('in', 'closed')).toBe('out')
  })

  it('keeps the Operator in while the session stands', () => {
    expect(afterCheck('in', 'open')).toBe('in')
  })

  it('keeps the Operator in while the Command Post does not answer: a signal lost is not a session lost', () => {
    expect(afterCheck('in', 'unknown')).toBe('in')
  })

  it('lets nobody back in without a login, whatever a late answer says', () => {
    expect(afterCheck('out', 'open')).toBe('out')
    expect(afterCheck('out', 'unknown')).toBe('out')
    expect(afterCheck('out', 'closed')).toBe('out')
  })
})
