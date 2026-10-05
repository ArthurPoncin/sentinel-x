import { describe, expect, it } from 'vitest'
import { feedUrl } from './feed-url'

describe('feedUrl', () => {
  it('uses a secure socket when the app is served over HTTPS', () => {
    expect(feedUrl({ protocol: 'https:', host: 'sentinel.local' })).toBe('wss://sentinel.local/ws')
  })

  it('uses a plain socket on the dev server', () => {
    expect(feedUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  })
})
