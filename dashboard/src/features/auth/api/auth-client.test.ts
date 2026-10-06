import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkSession, loginOutcome, sessionAnswer } from './auth-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('sessionAnswer', () => {
  it('reads a 204 as a session, a 401 as none', () => {
    expect(sessionAnswer(204)).toBe('open')
    expect(sessionAnswer(401)).toBe('closed')
  })

  it('reads nothing about the session in anything else: a proxy without its API, an error', () => {
    expect(sessionAnswer(502)).toBe('unknown')
    expect(sessionAnswer(500)).toBe('unknown')
    expect(sessionAnswer(200)).toBe('unknown')
  })
})

describe('checkSession', () => {
  it('asks the Command Post on the app’s own origin, with the session cookie', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    expect(await checkSession()).toBe('open')
    expect(fetch.mock.calls[0]).toEqual(['/api/v1/auth/check', { credentials: 'same-origin' }])
  })

  it('says the session is closed on a 401', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }))

    expect(await checkSession()).toBe('closed')
  })

  it('does not know when the Command Post cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    expect(await checkSession()).toBe('unknown')
  })
})
