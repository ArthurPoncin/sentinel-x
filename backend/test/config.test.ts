import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('configuration from the environment', () => {
  it('leaves the mock feed off unless asked', () => {
    expect(loadConfig({}).mockFeed).toBe(false)
  })

  it('turns the mock feed on with MOCK_FEED=true, one tick per second', () => {
    expect(loadConfig({ MOCK_FEED: 'true' }).mockFeed).toEqual({ intervalMs: 1000 })
  })

  it('paces the mock feed with MOCK_FEED_INTERVAL_MS', () => {
    const config = loadConfig({ MOCK_FEED: 'true', MOCK_FEED_INTERVAL_MS: '250' })

    expect(config.mockFeed).toEqual({ intervalMs: 250 })
  })

  it('listens on localhost:8080 unless HOST and PORT say otherwise', () => {
    expect(loadConfig({})).toMatchObject({ host: '127.0.0.1', port: 8080 })
    expect(loadConfig({ HOST: '0.0.0.0', PORT: '9000' })).toMatchObject({ host: '0.0.0.0', port: 9000 })
  })

  it('names the variable it cannot make sense of', () => {
    expect(() => loadConfig({ MOCK_FEED: 'yes' })).toThrow(/MOCK_FEED/)
    expect(() => loadConfig({ PORT: 'http' })).toThrow(/PORT/)
  })
})
