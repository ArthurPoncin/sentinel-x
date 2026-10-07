import { describe, expect, it } from 'vitest'
import { feedEncrypted, feedUrl } from './feed-url'

describe('feedUrl', () => {
  it('uses a secure socket when the app is served over HTTPS', () => {
    expect(feedUrl({ protocol: 'https:', host: 'sentinel.local' })).toBe('wss://sentinel.local/ws')
  })

  it('uses a plain socket on the dev server', () => {
    expect(feedUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  })
})

describe('feedEncrypted', () => {
  it('says the feed is encrypted when the app is served over HTTPS', () => {
    expect(feedEncrypted({ protocol: 'https:', host: 'sentinel.local' })).toBe(true)
  })

  it('says it is not on the dev server', () => {
    expect(feedEncrypted({ protocol: 'http:', host: 'localhost:5173' })).toBe(false)
  })
})
