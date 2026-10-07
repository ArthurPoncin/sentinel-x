import { describe, expect, it } from 'vitest'
import { STATUS_COLORS } from '@/shared/config/status-colors'
import type { Alert, Severity, StatusLevel } from '@/shared/contract'
import { ENCLOSURE_PARTS } from './enclosure-parts'
import { CALM_AIR, CRITICAL_AIR } from './gas-level'
import { CALM_TEMP, PEAK_TEMP } from './heat-level'
import {
  CALM_COLOR,
  DRIFT_COLOR,
  DRIVER_PROBES,
  driftLabel,
  FLOODLIGHT_COLOR,
  GAS_COLOR,
  LCD_TEXT,
  mix,
  NEUTRAL_LIGHT,
  NEUTRAL_RIM,
  PRESENCE_COLOR,
  STATUS_GRADES,
  type TwinState,
  toScene,
} from './scene'
import { alongPipe, gatePoint, SITE, watchedPoint } from './site'

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

function withTemp(temp: number): TwinState {
  return state({
    latestTelemetry: { sentinel: 'sentinel-01', ts, readings: { temp, humidity: 44, air: 185, pir: false, sound: 0.02 } },
  })
}

const base = { sentinel: 'sentinel-01', state: 'raised', ts } as const

// As the vision service raises it: sure at 88 % unless `seen` says otherwise.
function intrusion(
  alertId: string,
  x_norm: number,
  seen: { confidence?: number; bbox?: [number, number, number, number] } = {},
): Alert {
  return {
    ...base,
    alert_id: alertId,
    source: 'vision',
    kind: 'intrusion',
    severity: 'critical',
    detail: { x_norm, confidence: 0.88, bbox: [0, 80, 60, 180], ...seen },
  }
}

function predictive(alertId: string, drivers: string[], anomaly_score = 0.91): Alert {
  return {
    ...base,
    alert_id: alertId,
    source: 'predictive',
    kind: 'predictive',
    severity: 'warning',
    detail: { anomaly_score, drivers },
  }
}

const gas: Alert = { ...base, alert_id: 'g1', source: 'esp32', kind: 'gas', severity: 'warning', detail: {} }
const thermal: Alert = { ...base, alert_id: 't1', source: 'esp32', kind: 'thermal', severity: 'warning', detail: {} }

function presence(alertId: string): Alert {
  return { ...base, alert_id: alertId, source: 'esp32', kind: 'presence', severity: 'warning', detail: {} }
}

// An Alert the Sentinel raises from its own Probes.
function sensed(kind: 'gas' | 'thermal' | 'presence' | 'noise', severity: Severity): Alert {
  return { ...base, alert_id: kind, source: 'esp32', kind, severity, detail: {} }
}

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
        alarm: null,
        pulses: [],
        drift: null,
      },
      haze: 0,
      status: STATUS_GRADES.nominal,
      thermal: { intensity: 0, shimmer: false },
      sector: { lit: false },
      intruder: null,
      presence: { active: false },
      floodlights: { lit: false },
      anchor: null,
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

  it('thickens the haze around the gas pipe with the gas Reading: none when calm, the most at its peak', () => {
    expect(toScene(withAir(180)).haze).toBe(0)
    expect(toScene(withAir(CALM_AIR)).haze).toBe(0)
    expect(toScene(withAir((CALM_AIR + CRITICAL_AIR) / 2)).haze).toBe(0.5)
    expect(toScene(withAir(CRITICAL_AIR)).haze).toBe(1)
    expect(toScene(withAir(840)).haze).toBe(1)
  })

  it("takes the haze over the range of the Enclosure's glow", () => {
    for (const air of [150, CALM_AIR, 260, 320, 480, CRITICAL_AIR, 840]) {
      const scene = toScene(withAir(air))

      expect(scene.haze, `air ${air}`).toBe(scene.enclosure.glow)
    }
  })

  it('has the haze follow the gas Reading, not the Alerts nor the Status', () => {
    expect(toScene({ ...withAir(CRITICAL_AIR), status: 'nominal' }).haze).toBe(1)
    expect(toScene(state({ status: 'critical', activeAlerts: [sensed('gas', 'critical')] })).haze).toBe(0)
  })

  it.each(['gas', 'thermal'] as const)('sounds the Alarm while a %s Alert is active', (kind) => {
    expect(toScene(state({ activeAlerts: [sensed(kind, 'warning')] })).enclosure.alarm).toEqual({
      severity: 'warning',
      color: STATUS_COLORS.elevated,
    })
  })

  it('rests the Alarm when no gas or thermal Alert is left, whatever else is active', () => {
    const others = [sensed('presence', 'warning'), sensed('noise', 'info'), intrusion('i1', 0.2), predictive('p1', [])]

    expect(toScene(state()).enclosure.alarm).toBeNull()
    expect(toScene(state({ status: 'critical', activeAlerts: others })).enclosure.alarm).toBeNull()
  })

  it('gives the Alarm the color of the highest severity among its Alerts, whatever their order', () => {
    const alarm = (...activeAlerts: Alert[]) => toScene(state({ activeAlerts })).enclosure.alarm

    expect(alarm(sensed('gas', 'info'))).toEqual({ severity: 'info', color: STATUS_COLORS.nominal })
    expect(alarm(sensed('gas', 'warning'), sensed('thermal', 'info'))).toEqual({
      severity: 'warning',
      color: STATUS_COLORS.elevated,
    })
    expect(alarm(sensed('gas', 'critical'), sensed('thermal', 'warning'))).toEqual({
      severity: 'critical',
      color: STATUS_COLORS.critical,
    })
    expect(alarm(sensed('thermal', 'warning'), sensed('gas', 'critical'))).toEqual(
      alarm(sensed('gas', 'critical'), sensed('thermal', 'warning')),
    )
  })

  it('takes the severity of the Alarm from the gas and thermal Alerts alone', () => {
    const scene = toScene(state({ status: 'critical', activeAlerts: [intrusion('i1', 0.2), sensed('gas', 'warning')] }))

    expect(scene.enclosure.alarm?.severity).toBe('warning')
    // The color the LED ring goes back to breathing in is still the Status's.
    expect(scene.enclosure.ring).toEqual({ color: STATUS_GRADES.critical.perimeter })
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

    for (const key of ['background', 'rim', 'perimeter'] as const) {
      expect(new Set(grades.map((grade) => grade[key])).size).toBe(grades.length)
    }
  })

  it.each<StatusLevel>(['nominal', 'elevated', 'critical'])('lights the model in neutral at %s', (level) => {
    expect(toScene(state({ status: level })).status.light).toBe(NEUTRAL_LIGHT)
  })

  it('keeps the rim light the cold one of the studio when nominal', () => {
    expect(toScene(state({ status: 'nominal' })).status.rim).toBe(NEUTRAL_RIM)
  })

  it.each(['elevated', 'critical'] as const)(
    'keeps the light neutral at %s and shows the Status on the rim light, the ring around the socle, the LCD and the LED ring',
    (level) => {
      const color = STATUS_COLORS[level]
      const scene = toScene(state({ status: level }))

      expect(scene.status).toMatchObject({ light: NEUTRAL_LIGHT, rim: color, perimeter: color })
      expect(scene.enclosure.lcd.color).toBe(color)
      expect(scene.enclosure.ring.color).toBe(color)
    },
  )

  it.each<StatusLevel>(['nominal', 'elevated', 'critical'])(
    "rings the perimeter in the dashboard's %s color",
    (level) => {
      expect(toScene(state({ status: level })).status.perimeter).toBe(STATUS_COLORS[level])
    },
  )

  it('follows the Status, not the gas', () => {
    expect(toScene({ ...withAir(CRITICAL_AIR), status: 'nominal' }).status.level).toBe('nominal')
  })

  it("makes the hall's roof glow as the temperature rises, neutral when calm and full at the peak", () => {
    expect(toScene(withTemp(CALM_TEMP)).thermal.intensity).toBe(0)
    expect(toScene(withTemp((CALM_TEMP + PEAK_TEMP) / 2)).thermal.intensity).toBeCloseTo(0.5)
    expect(toScene(withTemp(PEAK_TEMP)).thermal.intensity).toBe(1)
  })

  it('ripples the air above the hall while a thermal Alert is active, and only then', () => {
    expect(toScene(state({ activeAlerts: [gas] })).thermal.shimmer).toBe(false)
    expect(toScene(state({ activeAlerts: [gas, thermal] })).thermal.shimmer).toBe(true)
  })

  it('follows the temperature for the glow and the Alert for the ripple, each on its own', () => {
    expect(toScene(withTemp(PEAK_TEMP)).thermal).toEqual({ intensity: 1, shimmer: false })
    expect(toScene({ ...withTemp(CALM_TEMP), activeAlerts: [thermal] }).thermal).toEqual({ intensity: 0, shimmer: true })
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

  // The model's 7 features, the closed vocabulary of `drivers` (docs/ARCHITECTURE.md), and the Probe each is
  // read from.
  const FEATURE_PROBES = [
    ['temp', 'dht22'],
    ['temp_slope', 'dht22'],
    ['temp_mean', 'dht22'],
    ['humidity', 'dht22'],
    ['air', 'mq2'],
    ['air_slope', 'mq2'],
    ['air_mean', 'mq2'],
  ] as const

  it.each(FEATURE_PROBES)('pulses the Probe a predictive Alert says is drifting: on %s, the %s', (driver, probe) => {
    expect(pulsesFor(predictive('p1', [driver]))).toEqual([probe])
  })

  it('knows the drivers the model can name, and no other', () => {
    expect(Object.fromEntries(DRIVER_PROBES)).toEqual(Object.fromEntries(FEATURE_PROBES))
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
    expect(pulsesFor(predictive('p1', ['temp_mean', 'temp', 'humidity']))).toEqual(['dht22'])
    expect(pulsesFor(predictive('p1', ['air_mean', 'air', 'temp']))).toEqual(['mq2', 'dht22'])
  })

  it('names the Probes it pulses as the Enclosure does', () => {
    for (const probe of DRIVER_PROBES.values()) expect(ENCLOSURE_PARTS).toHaveProperty(probe)
  })

  it('pulses nothing on a driver it does not know, and still pulses the others', () => {
    expect(pulsesFor(predictive('p1', ['humidity_slope', 'constructor']))).toEqual([])
    expect(pulsesFor(predictive('p1', ['humidity_slope', 'air_slope']))).toEqual(['mq2'])
    expect(pulsesFor(predictive('p1', []))).toEqual([])
  })

  const driftFor = (...activeAlerts: Alert[]) => toScene(state({ activeAlerts })).enclosure.drift

  it('labels the drift with the score of the predictive Alert: « dérive · score 0.91 »', () => {
    expect(driftFor(predictive('p1', ['temp_slope', 'air_slope']))).toEqual({
      score: 0.91,
      label: 'dérive · score 0.91',
    })
  })

  it('labels the drift of an Alert that names a Reading or a mean, not only a slope', () => {
    expect(driftFor(predictive('p1', ['temp'], 0.83))?.label).toBe('dérive · score 0.83')
    expect(driftFor(predictive('p1', ['air_mean'], 0.77))?.label).toBe('dérive · score 0.77')
  })

  it('gives the score to two decimals', () => {
    expect(driftLabel(0.9)).toBe('dérive · score 0.90')
    expect(driftLabel(0.876)).toBe('dérive · score 0.88')
    expect(driftLabel(1)).toBe('dérive · score 1.00')
  })

  it('labels nothing without an active predictive Alert, whatever else is raised', () => {
    expect(driftFor()).toBeNull()
    expect(driftFor(gas, thermal, intrusion('i1', 0.2), presence('pr1'))).toBeNull()
  })

  it('labels nothing for a predictive Alert that pulses no Probe: no driver, or none it knows', () => {
    expect(driftFor(predictive('p1', []))).toBeNull()
    expect(driftFor(predictive('p1', ['humidity_slope', 'constructor']))).toBeNull()
  })

  it('labels the score of the last raised predictive Alert that pulses a Probe', () => {
    expect(driftFor(predictive('p1', ['temp_slope'], 0.72), predictive('p2', ['air_slope'], 0.94))?.label).toBe(
      'dérive · score 0.94',
    )
    expect(driftFor(predictive('p1', ['temp_slope'], 0.72), predictive('p2', ['wind_slope'], 0.94))?.label).toBe(
      'dérive · score 0.72',
    )
  })

  it('labels and pulses the drift the same at nominal as at elevated', () => {
    const alerts = [predictive('p1', ['temp_slope', 'air_slope'])]
    const nominal = toScene(state({ status: 'nominal', activeAlerts: alerts })).enclosure
    const elevated = toScene(state({ status: 'elevated', activeAlerts: alerts })).enclosure

    expect(elevated.pulses).toEqual(nominal.pulses)
    expect(elevated.drift).toEqual(nominal.drift)
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
      alertId: 'i2',
      x_norm: 0.7,
      confidence: 0.88,
      label: 'PERSONNE · 88 %',
      at: watchedPoint(0.7),
    })
  })

  it('gives the confidence of the vision model with the place of the intruder, and the label that reads it', () => {
    const seen = intrusion('i1', 0.4, { confidence: 0.62 })

    expect(toScene(state({ activeAlerts: [seen] })).intruder).toMatchObject({
      x_norm: 0.4,
      confidence: 0.62,
      label: 'PERSONNE · 62 %',
    })
  })

  it('updates the label when the confidence changes on the same Alert, which stays the same intruder', () => {
    const surer = intrusion('i1', 0.4, { confidence: 0.93 })
    const before = toScene(state({ activeAlerts: [intrusion('i1', 0.4)] })).intruder
    const after = toScene(state({ activeAlerts: [surer] })).intruder

    expect(before?.label).toBe('PERSONNE · 88 %')
    expect(after?.label).toBe('PERSONNE · 93 %')
    expect(after?.alertId).toBe(before?.alertId)
    expect(after?.at).toEqual(before?.at)
  })

  it('places the intruder by x_norm alone, whatever the bbox of its Alert', () => {
    const elsewhere = intrusion('i1', 0.4, { bbox: [500, 10, 20, 40] })

    expect(toScene(state({ activeAlerts: [elsewhere] })).intruder).toEqual(
      toScene(state({ activeAlerts: [intrusion('i1', 0.4)] })).intruder,
    )
  })

  const intruderAt = (x_norm: number) => toScene(state({ activeAlerts: [intrusion('i1', x_norm)] })).intruder?.at

  it("stands the intruder on the perimeter, where the camera's sight meets the fence", () => {
    for (const x_norm of [0, 0.15, 0.5, 0.85, 1]) {
      const at = intruderAt(x_norm)
      expect(at).toEqual(watchedPoint(x_norm))
      expect(Math.hypot(at?.x ?? 0, at?.z ?? 0)).toBeCloseTo(SITE.fence.radius)
    }
  })

  it("moves the intruder along the arc as x_norm changes, from the lens's left to its right", () => {
    // As the mock feed plays it: a new x_norm a second, the same Alert.
    const steps = [0.15, 0.35, 0.55, 0.75].map(intruderAt)
    // The lens looks out toward the entrance, +z: its left is toward +x.
    const across = steps.map((at) => at?.x ?? 0)

    expect(new Set(across.map((x) => x.toFixed(6))).size).toBe(steps.length)
    expect(across).toEqual([...across].sort((a, b) => b - a))
  })

  const presenceFor = (...activeAlerts: Alert[]) => toScene(state({ activeAlerts })).presence

  it('shows a presence while a presence Alert is active, whatever else is raised', () => {
    expect(presenceFor(presence('p1'))).toEqual({ active: true })
    expect(presenceFor(gas, presence('p1'), intrusion('i1', 0.2))).toEqual({ active: true })
  })

  it('shows no presence without a presence Alert: before one is raised, once it is cleared', () => {
    // A cleared Alert is no longer among the active ones: the store takes it out.
    expect(presenceFor()).toEqual({ active: false })
    expect(presenceFor(gas, intrusion('i1', 0.2), predictive('d1', ['air_slope']))).toEqual({ active: false })
  })

  it('shows a presence until the last of several presence Alerts is cleared', () => {
    expect(presenceFor(presence('p1'), presence('p2')).active).toBe(true)
    expect(presenceFor(presence('p2')).active).toBe(true)
    expect(presenceFor().active).toBe(false)
  })

  const floodlightsFor = (...activeAlerts: Alert[]) => toScene(state({ activeAlerts })).floodlights

  it('lights the floodlights while a presence Alert is active, or an intrusion one, or both', () => {
    expect(floodlightsFor(presence('p1'))).toEqual({ lit: true })
    expect(floodlightsFor(intrusion('i1', 0.2))).toEqual({ lit: true })
    expect(floodlightsFor(gas, presence('p1'), intrusion('i1', 0.2))).toEqual({ lit: true })
  })

  it('leaves the floodlights dark at rest, and whatever else is raised', () => {
    const others = [gas, thermal, sensed('noise', 'info'), predictive('d1', ['air_slope'])]

    expect(floodlightsFor()).toEqual({ lit: false })
    expect(floodlightsFor(...others)).toEqual({ lit: false })
  })

  it('keeps the floodlights lit until the last presence and the last intrusion are cleared', () => {
    expect(floodlightsFor(presence('p1'), intrusion('i1', 0.2), intrusion('i2', 0.7)).lit).toBe(true)
    expect(floodlightsFor(intrusion('i2', 0.7)).lit).toBe(true)
    expect(floodlightsFor(presence('p1')).lit).toBe(true)
    expect(floodlightsFor().lit).toBe(false)
  })

  it('lights the floodlights in white, which is no Status color', () => {
    expect(Object.values(STATUS_COLORS)).not.toContain(FLOODLIGHT_COLOR)
  })

  it('shows a presence in amber, the color of the elevated Status', () => {
    expect(PRESENCE_COLOR).toBe(STATUS_COLORS.elevated)
  })

  const anchorFor = (...activeAlerts: Alert[]) => toScene(state({ activeAlerts })).anchor

  it('anchors nothing while no Alert is active', () => {
    expect(anchorFor()).toBeNull()
  })

  it('anchors an intrusion where its intruder stands', () => {
    for (const x_norm of [0.15, 0.35, 0.55, 0.75]) {
      const scene = toScene(state({ activeAlerts: [intrusion('i1', x_norm)] }))

      expect(scene.anchor).toEqual({ alertId: 'i1', at: watchedPoint(x_norm) })
      expect(scene.anchor?.at).toEqual(scene.intruder?.at)
    }
  })

  it('anchors a gas Alert on the gas pipe, halfway along it', () => {
    const { path } = SITE.pipe

    expect(anchorFor(gas)).toEqual({ alertId: 'g1', at: alongPipe(0.5) })
    // On the stretch that leaves the hall, between its two ends.
    expect(anchorFor(gas)?.at.x).toBeCloseTo(path[0].x)
    expect(anchorFor(gas)?.at.z).toBeGreaterThan(path[0].z)
    expect(anchorFor(gas)?.at.z).toBeLessThan(path[1].z)
  })

  it('anchors a thermal Alert on the generator hall', () => {
    expect(anchorFor(thermal)).toEqual({ alertId: 't1', at: { x: SITE.hall.x, z: SITE.hall.z } })
  })

  it('anchors a presence Alert at the gate', () => {
    expect(anchorFor(presence('pr1'))).toEqual({ alertId: 'pr1', at: gatePoint() })
  })

  it('anchors a predictive Alert on the Enclosure, whatever it says is drifting', () => {
    const onEnclosure = { x: SITE.enclosure.x, z: SITE.enclosure.z }

    expect(anchorFor(predictive('p1', ['temp_slope']))).toEqual({ alertId: 'p1', at: onEnclosure })
    expect(anchorFor(predictive('p1', []))).toEqual({ alertId: 'p1', at: onEnclosure })
  })

  it('gives a noise Alert no anchor, and leaves the one of the Alert raised before it', () => {
    expect(anchorFor(sensed('noise', 'info'))).toBeNull()
    expect(anchorFor(gas, sensed('noise', 'info'))).toEqual(anchorFor(gas))
  })

  it('anchors the last raised of the active Alerts, and the one before it once that one is cleared', () => {
    // The feed keeps the active Alerts in the order they were first raised, and takes a cleared one out.
    expect(anchorFor(predictive('p1', ['air_slope']), gas, presence('pr1'))?.alertId).toBe('pr1')
    expect(anchorFor(predictive('p1', ['air_slope']), gas)?.alertId).toBe('g1')
    expect(anchorFor(predictive('p1', ['air_slope']))?.alertId).toBe('p1')
  })

  it('keeps the anchor on the last raised Alert when one raised before it is sent again', () => {
    // An Alert raised again keeps its place among the active ones: its intruder moved, it is no newer.
    expect(anchorFor(intrusion('i1', 0.55), gas)?.alertId).toBe('g1')
  })

  it('gives each kind of Alert an anchor of its own, on the socle', () => {
    const anchors = [intrusion('i1', 0.15), gas, thermal, presence('pr1'), predictive('p1', [])].map(
      (alert) => anchorFor(alert)?.at,
    )

    expect(new Set(anchors.map((at) => `${at?.x.toFixed(3)} ${at?.z.toFixed(3)}`)).size).toBe(anchors.length)
    for (const at of anchors) expect(Math.hypot(at?.x ?? 0, at?.z ?? 0)).toBeLessThan(SITE.socle.radius)
  })

  it('does not change the state it is given', () => {
    const given = state({ status: 'critical', activeAlerts: [intrusion('i1', 0.2)] })
    const copy = structuredClone(given)

    toScene(given)

    expect(given).toEqual(copy)
  })
})
