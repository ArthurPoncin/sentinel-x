import { describe, expect, it } from 'vitest'
import { channelOf, REFUSAL, utcClock } from './login-copy'

describe('the login screen copy', () => {
  it('calls the channel encrypted only over HTTPS', () => {
    expect(channelOf('https:')).toEqual({ secure: true, label: 'Canal chiffré · TLS' })
    expect(channelOf('http:').secure).toBe(false)
  })

  it('reads the clock in UTC, to the second', () => {
    expect(utcClock(new Date('2026-10-06T14:23:05.789+02:00'))).toBe('12:23:05 UTC')
  })

  it('has a line for every refusal', () => {
    expect(Object.keys(REFUSAL).sort()).toEqual(['throttled', 'unreachable', 'wrong-password'])
  })
})
