import { describe, expect, it } from 'vitest'
import { createAlertPipeline } from '../src/alerts.js'
import { AlertSchema, type Frame, TelemetrySchema } from '../src/contract.js'
import { createMemoryHistory } from '../src/history.js'
import { listIncidents } from '../src/incidents.js'
import { type MockTick, mockTicks } from '../src/mock-feed.js'
import { createTelemetryPipeline } from '../src/telemetry.js'

// One loop of the scenario is 40 ticks.
const LOOP = 40

function firstTicks(count: number, run = 'test'): MockTick[] {
  const ticks: MockTick[] = []
  for (const tick of mockTicks(run)) {
    ticks.push(tick)
    if (ticks.length === count) break
  }
  return ticks
}

// Plays the ticks through the real pipelines, as the server does, and keeps what comes out.
function play(ticks: MockTick[]) {
  const frames: Frame[] = []
  const hub = { broadcast: (frame: Frame) => frames.push(frame) }
  const history = createMemoryHistory()
  const telemetry = createTelemetryPipeline(hub, history)
  const alerts = createAlertPipeline(hub, history)
  for (const tick of ticks) {
    telemetry.accept(tick.telemetry)
    for (const alert of tick.alerts) alerts.accept(alert)
  }
  return { frames, history }
}

const alertsOf = (ticks: MockTick[]) => ticks.flatMap((tick) => tick.alerts)

describe('mock feed script', () => {
  it('emits one telemetry snapshot per tick, and only what validates against the contract', () => {
    for (const { telemetry, alerts } of firstTicks(3 * LOOP)) {
      expect(TelemetrySchema.safeParse(telemetry)).toMatchObject({ success: true })
      for (const alert of alerts) expect(AlertSchema.safeParse(alert)).toMatchObject({ success: true })
    }
  })

  it('sends every kind of Alert, each from the producer that owns it', () => {
    const sources = Object.fromEntries(alertsOf(firstTicks(LOOP)).map((alert) => [alert.kind, alert.source]))

    expect(sources).toEqual({
      gas: 'esp32',
      thermal: 'esp32',
      presence: 'esp32',
      noise: 'esp32',
      intrusion: 'vision',
      predictive: 'predictive',
    })
  })

  it('walks the Status from nominal to elevated, critical and back, intruder included, in a loop', () => {
    const { frames } = play(firstTicks(2 * LOOP))
    const statuses = frames.flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))
    // Consecutive duplicates removed: an Alert that leaves the Status as it was still sends it.
    const changes = statuses.filter((status, index) => status !== statuses[index - 1])

    const loop = ['elevated', 'critical', 'elevated', 'nominal', 'critical', 'nominal']
    expect(changes).toEqual([...loop, ...loop])
  })

  it('clears every Alert it raised by the end of each loop', () => {
    const { frames } = play(firstTicks(LOOP))
    const last = frames.findLast((frame) => frame.type === 'status')

    expect(last).toMatchObject({ payload: { status: 'nominal' } })
  })

  it('makes three Incidents a loop: the gas leak, the clap and the intruder', () => {
    const { history } = play(firstTicks(LOOP))

    expect(listIncidents(history)).toMatchObject([
      { kinds: ['predictive', 'gas', 'presence', 'thermal'], peak: 'critical', alerts: 10, ongoing: false },
      { kinds: ['noise'], peak: 'info', alerts: 2, ongoing: false },
      { kinds: ['intrusion'], peak: 'critical', alerts: 5, ongoing: false },
    ])
  })

  it('records the telemetry and the Alerts it plays in the history', () => {
    const ticks = firstTicks(LOOP)
    const { history } = play(ticks)
    const range = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' }

    const records = history.query(range)
    expect(records.filter((record) => record.type === 'telemetry')).toHaveLength(LOOP)
    expect(records.filter((record) => record.type === 'alert')).toHaveLength(alertsOf(ticks).length)
  })

  it('gives each loop and each run alert_ids of its own', () => {
    const [first, second] = [firstTicks(2 * LOOP, 'run-a'), firstTicks(LOOP, 'run-b')]
    const ids = (ticks: MockTick[]) => [...new Set(alertsOf(ticks).map((alert) => alert.alert_id))]

    const [firstLoop, secondLoop] = [ids(first.slice(0, LOOP)), ids(first.slice(LOOP))]
    expect(secondLoop.filter((id) => firstLoop.includes(id))).toEqual([])
    expect(ids(second).filter((id) => firstLoop.includes(id))).toEqual([])
  })

  it('walks the intruder in toward the camera, which turns to follow them, someone else behind them at the end', () => {
    const seen = alertsOf(firstTicks(LOOP)).flatMap((alert) =>
      alert.kind === 'intrusion' && alert.state === 'raised' ? [alert.detail] : [],
    )
    const tall = seen.map((detail) => detail.h_norm ?? 0)
    const turned = seen.map((detail) => detail.pan ?? 0)

    expect(seen.length).toBeGreaterThan(1)
    // Taller and taller in the image: nearer and nearer.
    expect(tall).toEqual([...tall].sort((a, b) => a - b))
    expect(tall.at(-1)).toBeGreaterThan(2 * (tall.at(0) ?? 1))
    // The camera rests, turns to its right where they came in, then follows them to its left.
    expect(turned.at(0)).toBe(0)
    expect(Math.max(...turned)).toBeGreaterThan(10)
    expect(turned.at(-1)).toBeLessThan(-10)
    // Once it follows them, they stay near the middle of its image.
    expect(seen.slice(1).every((detail) => Math.abs(detail.x_norm - 0.5) < 0.1)).toBe(true)
    expect(new Set(seen.map((detail) => detail.id)).size).toBe(1)
    expect(seen.map((detail) => detail.others?.length ?? 0)).toEqual([0, 0, 1, 1])
  })

  it('gives the intruder a box that goes with where it is in the image and how tall', () => {
    for (const alert of alertsOf(firstTicks(LOOP))) {
      if (alert.kind !== 'intrusion') continue
      const { x_norm, h_norm, bbox } = alert.detail
      const [left, top, width, height] = bbox

      expect((left + width / 2) / 640).toBeCloseTo(x_norm, 2)
      expect(height / 480).toBeCloseTo(h_norm ?? 0, 2)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(top + height).toBeLessThanOrEqual(480)
    }
  })

  it('raises the gas reading as the leak worsens, and the sound reading on the clap only', () => {
    const ticks = firstTicks(LOOP)
    const air = ticks.map((tick) => tick.telemetry.readings.air)
    const sound = ticks.map((tick) => tick.telemetry.readings.sound)

    expect(Math.max(...air)).toBeGreaterThan(600)
    expect(air.at(-1)).toBeLessThan(200)
    expect(sound.filter((level) => level > 0.5)).toHaveLength(1)
    expect(Math.min(...sound)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...sound)).toBeLessThanOrEqual(1)
  })
})
