import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

// The Operator's password hash every configuration needs, unless it turns the login off.
const operator = { OPERATOR_PASSWORD_HASH: `scrypt:${'0'.repeat(32)}:${'1'.repeat(128)}` }

describe('configuration from the environment', () => {
  it('leaves the mock feed off unless asked', () => {
    expect(loadConfig({ ...operator }).mockFeed).toBe(false)
  })

  it('turns the mock feed on with MOCK_FEED=true, one tick per second', () => {
    expect(loadConfig({ ...operator, MOCK_FEED: 'true' }).mockFeed).toEqual({ intervalMs: 1000 })
  })

  it('paces the mock feed with MOCK_FEED_INTERVAL_MS', () => {
    const config = loadConfig({ ...operator, MOCK_FEED: 'true', MOCK_FEED_INTERVAL_MS: '250' })

    expect(config.mockFeed).toEqual({ intervalMs: 250 })
  })

  it('listens on localhost:8080 unless HOST and PORT say otherwise', () => {
    expect(loadConfig({ ...operator })).toMatchObject({ host: '127.0.0.1', port: 8080 })
    expect(loadConfig({ ...operator, HOST: '0.0.0.0', PORT: '9000' })).toMatchObject({ host: '0.0.0.0', port: 9000 })
  })

  it('keeps the history in data/history.sqlite unless HISTORY_FILE says otherwise', () => {
    expect(loadConfig({ ...operator }).historyFile).toBe('data/history.sqlite')
    expect(loadConfig({ ...operator, HISTORY_FILE: '/var/lib/sentinel-x/history.sqlite' }).historyFile).toBe(
      '/var/lib/sentinel-x/history.sqlite',
    )
  })

  it('allows no other origin unless CORS_ORIGINS lists them', () => {
    expect(loadConfig({ ...operator }).corsOrigins).toEqual([])
    expect(loadConfig({ ...operator, CORS_ORIGINS: 'https://192.168.4.1, http://localhost:5173,' }).corsOrigins).toEqual([
      'https://192.168.4.1',
      'http://localhost:5173',
    ])
  })

  it('refuses in CORS_ORIGINS what is not an http(s) origin', () => {
    expect(() => loadConfig({ ...operator, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/)
    expect(() => loadConfig({ ...operator, CORS_ORIGINS: 'ftp://192.168.4.1' })).toThrow(/CORS_ORIGINS/)
    expect(() => loadConfig({ ...operator, CORS_ORIGINS: 'http://localhost:5173/' })).toThrow(/no path.*CORS_ORIGINS/s)
    expect(() => loadConfig({ ...operator, CORS_ORIGINS: 'https://192.168.4.1/twin' })).toThrow(/CORS_ORIGINS/)
  })

  it('names the variable it cannot make sense of', () => {
    expect(() => loadConfig({ ...operator, MOCK_FEED: 'yes' })).toThrow(/MOCK_FEED/)
    expect(() => loadConfig({ ...operator, PORT: 'http' })).toThrow(/PORT/)
  })

  describe('service tokens', () => {
    const vision = 'a'.repeat(64)
    const predictive = 'b'.repeat(64)

    it('holds no token unless given: no AI service can post', () => {
      expect(loadConfig({ ...operator }).serviceTokens).toEqual({ vision: undefined, predictive: undefined })
    })

    it('reads each service its own token', () => {
      expect(loadConfig({ ...operator, VISION_TOKEN: vision, PREDICTIVE_TOKEN: predictive }).serviceTokens).toEqual({
        vision,
        predictive,
      })
    })

    it('refuses one token for both services', () => {
      expect(() => loadConfig({ ...operator, VISION_TOKEN: vision, PREDICTIVE_TOKEN: vision })).toThrow(/VISION_TOKEN.*PREDICTIVE_TOKEN/)
    })

    it('refuses a token short enough to be guessed, or with a space in it', () => {
      expect(() => loadConfig({ ...operator, VISION_TOKEN: 'secret' })).toThrow(/32 characters.*VISION_TOKEN/s)
      expect(() => loadConfig({ ...operator, PREDICTIVE_TOKEN: `${predictive} x` })).toThrow(/PREDICTIVE_TOKEN/)
    })
  })

  describe('Operator login', () => {
    it('asks for a session with the password hash in OPERATOR_PASSWORD_HASH', () => {
      expect(loadConfig({ ...operator }).operatorAuth).toEqual({ passwordHash: operator.OPERATOR_PASSWORD_HASH })
    })

    it('refuses to start without a password hash, rather than let anyone in', () => {
      expect(() => loadConfig({})).toThrow(/OPERATOR_PASSWORD_HASH is required/)
    })

    it('lets anyone in only when OPERATOR_AUTH=off says so', () => {
      expect(loadConfig({ OPERATOR_AUTH: 'off' }).operatorAuth).toBe(false)
      expect(loadConfig({ ...operator, OPERATOR_AUTH: 'off' }).operatorAuth).toBe(false)
      expect(() => loadConfig({ ...operator, OPERATOR_AUTH: 'no' })).toThrow(/OPERATOR_AUTH/)
    })

    it('refuses a password hash it cannot check against', () => {
      expect(() => loadConfig({ OPERATOR_PASSWORD_HASH: 'hunter2' })).toThrow(/hash-password.*OPERATOR_PASSWORD_HASH/s)
    })
  })

  describe('MQTT ingress', () => {
    const broker = {
      MQTT_URL: 'mqtts://mosquitto:8883',
      MQTT_PASSWORD: 'api-password',
      MQTT_CA_FILE: '/run/secrets/ca.crt',
    }

    it('stays off unless MQTT_URL names a broker', () => {
      expect(loadConfig({ ...operator }).mqtt).toBe(false)
    })

    it('reaches the broker as the `api` user, trusting the CA in MQTT_CA_FILE', () => {
      expect(loadConfig({ ...operator, ...broker }).mqtt).toEqual({
        url: 'mqtts://mosquitto:8883',
        username: 'api',
        password: 'api-password',
        caFile: '/run/secrets/ca.crt',
      })
    })

    it('logs in as MQTT_USERNAME when given', () => {
      expect(loadConfig({ ...operator, ...broker, MQTT_USERNAME: 'api-dev' }).mqtt).toMatchObject({ username: 'api-dev' })
    })

    it('refuses a broker URL that is not MQTTS', () => {
      expect(() => loadConfig({ ...operator, ...broker, MQTT_URL: 'mqtt://mosquitto:1883' })).toThrow(/mqtts.*MQTT_URL/s)
      expect(() => loadConfig({ ...operator, ...broker, MQTT_URL: 'mosquitto' })).toThrow(/MQTT_URL/)
    })

    it('names what is missing to reach the broker', () => {
      expect(() => loadConfig({ ...operator, ...broker, MQTT_PASSWORD: undefined })).toThrow(/MQTT_PASSWORD/)
      expect(() => loadConfig({ ...operator, ...broker, MQTT_CA_FILE: undefined })).toThrow(/MQTT_CA_FILE/)
    })
  })
})
