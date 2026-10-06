import { describe, expect, it } from 'vitest'
import { STATUS_COLORS } from '@/shared/config/status-colors'
import type { Alert, StatusLevel } from '@/shared/contract'
import { ENCLOSURE_PARTS } from './enclosure-parts'
import { CALM_AIR, CRITICAL_AIR } from './gas-level'
import {
  CALM_COLOR,
  DRIFT_COLOR,
  DRIVER_PROBES,
  GAS_COLOR,
  LCD_TEXT,
  mix,
  NEUTRAL_LIGHT,
  NEUTRAL_RIM,
  STATUS_GRADES,
  type TwinState,
  toScene,
} from './scene'

const ts = '2026-10-05T14:23:00.000Z'

// The state the feed starts in: nothing received, the first connection still being tried.
function state(overrides: Partial<TwinState> = {}): TwinState {
  return {
    connection: 'connecting',
    connectedOnce: false,
    status: 'nominal',
    latestTelemetry: null,
    activeAlerts: [],
    ...overrides,
  }
}

function withAir(air: number): TwinState {
  return state({
    latestTelemetry: { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.02 } },
  })
}

const base = { sentinel: 'sentinel-01', state: 'raised', ts } as const

function intrusion(alertId: string, x_norm: number): Alert {
  return {
    ...base,
    alert_id: alertId,
    source: 'vision',
    kind: 'intrusion',
    severity: 'critical',
    detail: { x_norm, confidence: 0.88, bbox: [0, 80, 60, 180] },
  }
}

function predictive(alertId: string, drivers: string[]): Alert {
  return {
    ...base,
    alert_id: alertId,
    source: 'predictive',
    kind: 'predictive',
    severity: 'warning',
    detail: { anomaly_score: 0.91, drivers },
  }
}

const gas: Alert = { ...base, alert_id: 'g1', source: 'esp32', kind: 'gas', severity: 'warning', detail: {} }

describe('mix', () => {
  it('goes from one color to the other', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ff8040', 0.5)).toBe('#804020')
  })
})

describe('toScene', () => {
  it('shows a calm, nominal Outpost before anything is received', () => {
    expect(toScene(state())).toEqual({
      enclosure: {
        color: CALM_COLOR,
        glow: 0,
        lcd: { text: 'NOMINAL', color: STATUS_GRADES.nominal.perimeter },
        ring: { color: STATUS_GRADES.nominal.perimeter },
        pulses: [],
      },
      status: STATUS_GRADES.nominal,
      sector: { lit: false },
      intruder: null,
      signalLost: false,
    })
  })

  it('turns the Enclosure red and makes it glow as gas rises', () => {
    expect(toScene(withAir(CALM_AIR)).enclosure).toMatchObject({ color: CALM_COLOR, glow: 0 })
    expect(toScene(withAir((CALM_AIR + CRITICAL_AIR) / 2)).enclosure).toMatchObject({
      color: mix(CALM_COLOR, GAS_COLOR, 0.5),
      glow: 0.5,
    })
    expect(toScene(withAir(CRITICAL_AIR)).enclosure).toMatchObject({ color: GAS_COLOR, glow: 1 })
  })

  it.each<StatusLevel>(['nominal', 'elevated', 'critical'])(
    'shows the %s Status on the LCD and breathes the LED ring in its color',
    (level) => {
      const { lcd, ring } = toScene(state({ status: level })).enclosure

      expect(lcd).toEqual({ text: LCD_TEXT[level], color: STATUS_GRADES[level].perimeter })
      expect(ring).toEqual({ color: STATUS_GRADES[level].perimeter })
    },
  )

  it('writes each Status its own way on the LCD, in capitals as the real one does', () => {
    expect(LCD_TEXT).toEqual({ nominal: 'NOMINAL', elevated: 'ELEVATED', critical: 'CRITICAL' })
  })

  it('keeps the LCD and the LED ring on the Status, whatever the gas', () => {
    const { lcd, ring } = toScene({ ...withAir(CRITICAL_AIR), status: 'nominal' }).enclosure

    expect(lcd.text).toBe('NOMINAL')
    expect(ring.color).toBe(STATUS_GRADES.nominal.perimeter)
  })

  it.each<StatusLevel>(['nominal', 'elevated', 'critical'])('grades the scene by the %s Status', (level) => {
    expect(toScene(state({ status: level })).status).toEqual({ ...STATUS_GRADES[level], level })
  })

  it('gives each Status its own colors', () => {
    const grades = Object.values(STATUS_GRADES)

    for (const key of ['background', 'light', 'rim', 'perimeter'] as const) {
      expect(new Set(grades.map((grade) => grade[key])).size).toBe(grades.length)
    }
  })

  it('lights the model in neutral when nominal', () => {
    expect(toScene(state({ status: 'nominal' })).status).toMatchObject({ light: NEUTRAL_LIGHT, rim: NEUTRAL_RIM })
  })

  it.each(['elevated', 'critical'] as const)('lights the whole model in the color of the %s Status', (level) => {
    const color = STATUS_COLORS[level]

    expect(toScene(state({ status: level })).status).toMatchObject({ light: color, rim: color })
  })

  it.each<StatusLevel>(['nominal', 'elevated', 'critical'])(
    "rings the perimeter in the dashboard's %s color",
    (level) => {
      expect(toScene(state({ status: level })).status.perimeter).toBe(STATUS_COLORS[level])
    },
  )

  it('follows the Status, not the gas', () => {
    expect(toScene({ ...withAir(CRITICAL_AIR), status: 'nominal' }).status.level).toBe('nominal')
  })

  it('has no signal to lose before the first connection, even if that one fails', () => {
    expect(toScene(state({ connection: 'connecting' })).signalLost).toBe(false)
    expect(toScene(state({ connection: 'closed' })).signalLost).toBe(false)
  })

  it('has its signal while the feed is open', () => {
    expect(toScene(state({ connection: 'open', connectedOnce: true })).signalLost).toBe(false)
  })

  it('has lost its signal once the feed closes after having been open, until it is open again', () => {
    const connected = (connection: TwinState['connection']) => state({ connection, connectedOnce: true })

    expect(toScene(connected('closed')).signalLost).toBe(true)
    expect(toScene(connected('connecting')).signalLost).toBe(true)
    expect(toScene(connected('open')).signalLost).toBe(false)
  })

  it('keeps what it last knew on screen when the signal is lost', () => {
    const known = { ...withAir(CRITICAL_AIR), status: 'critical', activeAlerts: [intrusion('i1', 0.2)] } as const
    const live = toScene({ ...known, connection: 'open', connectedOnce: true })
    const lost = toScene({ ...known, connection: 'closed', connectedOnce: true })

    expect(lost).toEqual({ ...live, signalLost: true })
  })

  const pulsesFor = (...activeAlerts: Alert[]) => toScene(state({ activeAlerts })).enclosure.pulses

  it('pulses the Probe a predictive Alert says is drifting: the DHT22 on temp_slope, the MQ-2 on air_slope', () => {
    expect(pulsesFor(predictive('p1', ['temp_slope']))).toEqual(['dht22'])
    expect(pulsesFor(predictive('p1', ['air_slope']))).toEqual(['mq2'])
  })

  it('pulses nothing without an active predictive Alert, whatever else is raised', () => {
    expect(pulsesFor()).toEqual([])
    expect(pulsesFor(gas, intrusion('i1', 0.2))).toEqual([])
  })

  it('pulses the Probes of every active predictive Alert, each once', () => {
    expect(pulsesFor(predictive('p1', ['temp_slope', 'air_slope']), gas, predictive('p2', ['air_slope']))).toEqual([
      'dht22',
      'mq2',
    ])
  })

  it('names the Probes it pulses as the Enclosure does', () => {
    for (const probe of DRIVER_PROBES.values()) expect(ENCLOSURE_PARTS).toHaveProperty(probe)
  })

  it('pulses nothing on a driver it does not know, and still pulses the others', () => {
    expect(pulsesFor(predictive('p1', ['humidity_slope', 'constructor']))).toEqual([])
    expect(pulsesFor(predictive('p1', ['humidity_slope', 'air_slope']))).toEqual(['mq2'])
    expect(pulsesFor(predictive('p1', []))).toEqual([])
  })

  it('pulses in a color of its own, not a Status color', () => {
    expect(Object.values(STATUS_COLORS)).not.toContain(DRIFT_COLOR)
  })

  it('lights the camera sector while an intrusion Alert is active, wherever the intruder stands', () => {
    expect(toScene(state({ activeAlerts: [intrusion('i1', 0.15)] })).sector).toEqual({ lit: true })
    expect(toScene(state({ activeAlerts: [gas, intrusion('i1', 0.75)] })).sector).toEqual({ lit: true })
  })

  it('leaves the camera sector dark without an intrusion Alert: before one is raised, once it is cleared', () => {
    // A cleared Alert is no longer among the active ones: the store takes it out.
    expect(toScene(state()).sector).toEqual({ lit: false })
    expect(toScene(state({ activeAlerts: [gas, predictive('p1', ['air_slope'])] })).sector).toEqual({ lit: false })
  })

  it('keeps the camera sector lit until the last of several intrusions is cleared', () => {
    expect(toScene(state({ activeAlerts: [intrusion('i1', 0.2), intrusion('i2', 0.7)] })).sector.lit).toBe(true)
    expect(toScene(state({ activeAlerts: [intrusion('i2', 0.7)] })).sector.lit).toBe(true)
    expect(toScene(state({ activeAlerts: [] })).sector.lit).toBe(false)
  })

  it('places the intruder of the last raised intrusion Alert', () => {
    expect(toScene(state({ activeAlerts: [gas] })).intruder).toBeNull()
    expect(toScene(state({ activeAlerts: [intrusion('i1', 0.2), gas, intrusion('i2', 0.7)] })).intruder).toEqual({
      x_norm: 0.7,
    })
  })

  it('does not change the state it is given', () => {
    const given = state({ status: 'critical', activeAlerts: [intrusion('i1', 0.2)] })
    const copy = structuredClone(given)

    toScene(given)

    expect(given).toEqual(copy)
  })
})
