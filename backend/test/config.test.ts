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

  describe('MQTT ingress', () => {
    const broker = {
      MQTT_URL: 'mqtts://mosquitto:8883',
      MQTT_PASSWORD: 'api-password',
      MQTT_CA_FILE: '/run/secrets/ca.crt',
    }

    it('stays off unless MQTT_URL names a broker', () => {
      expect(loadConfig({}).mqtt).toBe(false)
    })

    it('reaches the broker as the `api` user, trusting the CA in MQTT_CA_FILE', () => {
      expect(loadConfig(broker).mqtt).toEqual({
        url: 'mqtts://mosquitto:8883',
        username: 'api',
        password: 'api-password',
        caFile: '/run/secrets/ca.crt',
      })
    })

    it('logs in as MQTT_USERNAME when given', () => {
      expect(loadConfig({ ...broker, MQTT_USERNAME: 'api-dev' }).mqtt).toMatchObject({ username: 'api-dev' })
    })

    it('refuses a broker URL that is not MQTTS', () => {
      expect(() => loadConfig({ ...broker, MQTT_URL: 'mqtt://mosquitto:1883' })).toThrow(/mqtts.*MQTT_URL/s)
      expect(() => loadConfig({ ...broker, MQTT_URL: 'mosquitto' })).toThrow(/MQTT_URL/)
    })

    it('names what is missing to reach the broker', () => {
      expect(() => loadConfig({ ...broker, MQTT_PASSWORD: undefined })).toThrow(/MQTT_PASSWORD/)
      expect(() => loadConfig({ ...broker, MQTT_CA_FILE: undefined })).toThrow(/MQTT_CA_FILE/)
    })
  })
})
