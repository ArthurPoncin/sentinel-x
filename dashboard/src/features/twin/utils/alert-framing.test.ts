import { describe, expect, it } from 'vitest'
import type { Alert, Frame } from '@/shared/contract'
import {
  cameraTurn,
  FRAMING_HOLD,
  FRAMING_TURN,
  type Framing,
  newlyRaised,
  shortestTurn,
} from './alert-framing'
import { autoOrbitSpeed, type CameraTouch, RESUME_DELAY, RESUME_RAMP } from './auto-orbit'
import type { GroundPoint } from './site'

const ts = '2026-10-06T15:40:00.000Z'
const DEGREE = Math.PI / 180
// A frame at 60 images a second.
const FRAME = 1 / 60

function alert(kind: 'gas' | 'presence' | 'noise', state: Alert['state'], alertId: string = kind): Frame {
  return {
    type: 'alert',
    payload: { alert_id: alertId, sentinel: 'sentinel-01', source: 'esp32', kind, severity: 'warning', state, ts, detail: {} },
  }
}

function intrusion(x_norm: number, state: Alert['state'] = 'raised'): Frame {
  return {
    type: 'alert',
    payload: {
      alert_id: 'intruder',
      sentinel: 'sentinel-01',
      source: 'vision',
      kind: 'intrusion',
      severity: 'critical',
      state,
      ts,
      detail: { x_norm, confidence: 0.88, bbox: [0, 80, 60, 180] },
    },
  }
}

const telemetry = (): Frame => ({
  type: 'telemetry',
  payload: { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air: 185, pir: false, sound: 0.02 } },
})

describe('newlyRaised', () => {
  it('gives the Alerts raised among the frames that came in, in the order they came', () => {
    const seen = [telemetry()]

    expect(newlyRaised(seen, [...seen, alert('gas', 'raised'), telemetry(), alert('presence', 'raised')])).toEqual([
      'gas',
      'presence',
    ])
  })

  it('gives none for a cleared, nor for what is not an Alert', () => {
    const seen = [telemetry(), alert('gas', 'raised')]

    expect(newlyRaised(seen, [...seen, telemetry(), alert('gas', 'cleared')])).toEqual([])
  })

  it('does not take for new an intrusion sent again with the same alert_id, wherever its intruder now stands', () => {
    const seen = [telemetry(), intrusion(0.15)]

    expect(newlyRaised(seen, [...seen, intrusion(0.35)])).toEqual([])
    expect(newlyRaised([], [intrusion(0.15), intrusion(0.35), intrusion(0.55)])).toEqual(['intruder'])
  })

  it('does not take for new a gas Alert raised again as it gets worse, even as another is cleared with it', () => {
    // As the mock feed plays it: the gas goes critical on the tick the presence is cleared.
    const seen = [alert('gas', 'raised'), alert('presence', 'raised')]

    expect(newlyRaised(seen, [...seen, alert('gas', 'raised'), alert('presence', 'cleared')])).toEqual([])
  })

  it('takes for new an Alert raised again once it has been cleared', () => {
    const seen = [alert('presence', 'raised'), alert('presence', 'cleared')]

    expect(newlyRaised(seen, [...seen, alert('presence', 'raised')])).toEqual(['presence'])
  })

  it('gives nothing of the history already seen: the Alerts active as the Twin opens are past', () => {
    const seen = [telemetry(), alert('gas', 'raised'), intrusion(0.15)]

    expect(newlyRaised(seen, seen)).toEqual([])
  })

  it('gives nothing of a history that does not follow on from the one seen', () => {
    expect(newlyRaised([telemetry()], [telemetry(), alert('gas', 'raised')])).toEqual([])
  })

  it('gives the Alerts a replay raises, second after second, and again when it is played again', () => {
    const replay = [telemetry(), alert('gas', 'raised'), telemetry(), alert('presence', 'raised'), alert('gas', 'cleared')]
    const upTo = (count: number) => replay.slice(0, count)

    expect(newlyRaised(upTo(1), upTo(2))).toEqual(['gas'])
    expect(newlyRaised(upTo(2), upTo(4))).toEqual(['presence'])
    expect(newlyRaised(upTo(4), upTo(5))).toEqual([])
    // Back to its first second: nothing follows on, then it all comes again.
    expect(newlyRaised(upTo(5), upTo(1))).toEqual([])
    expect(newlyRaised(upTo(1), upTo(2))).toEqual(['gas'])
  })
})

describe('shortestTurn', () => {
  it('turns toward growing bearings when that is the shorter way, toward smaller ones otherwise', () => {
    expect(shortestTurn(10 * DEGREE, 70 * DEGREE)).toBeCloseTo(60 * DEGREE)
    expect(shortestTurn(70 * DEGREE, 10 * DEGREE)).toBeCloseTo(-60 * DEGREE)
  })

  it('goes round the back of the site when that is shorter than coming back through the front', () => {
    expect(shortestTurn(170 * DEGREE, -170 * DEGREE)).toBeCloseTo(20 * DEGREE)
    expect(shortestTurn(-170 * DEGREE, 170 * DEGREE)).toBeCloseTo(-20 * DEGREE)
  })

  it('never turns by more than half a turn, however many turns the camera has gone round', () => {
    for (const from of [-900, -200, -30, 0, 45, 179, 400, 1234]) {
      for (const to of [-180, -91, 0, 12, 90, 180]) {
        const turn = shortestTurn(from * DEGREE, to * DEGREE)

        expect(Math.abs(turn), `${from}° to ${to}°`).toBeLessThanOrEqual(Math.PI + 1e-9)
        expect(Math.cos(from * DEGREE + turn), `${from}° to ${to}°`).toBeCloseTo(Math.cos(to * DEGREE))
        expect(Math.sin(from * DEGREE + turn), `${from}° to ${to}°`).toBeCloseTo(Math.sin(to * DEGREE))
      }
    }
  })
})

describe('cameraTurn', () => {
  // The instant the Alert is raised, on the camera's clock.
  const RAISED = 100
  const FRAMED = FRAMING_TURN + FRAMING_HOLD
  const never: CameraTouch = { kind: 'never' }
  // The point of the site at `bearing`, as an anchor is.
  const at = (bearing: number, distance = 2): GroundPoint => ({
    x: distance * Math.sin(bearing),
    z: distance * Math.cos(bearing),
  })
  const framing = (bearing: number): Framing => ({ anchor: at(bearing), since: RAISED })
  // Where the camera stands `seconds` after the Alert was raised, having turned as it is told on every frame.
  function follow(from: number, to: number, seconds: number, touch: CameraTouch = never): number {
    let azimuth = from
    for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
      azimuth += cameraTurn(framing(to), azimuth, touch, RAISED + elapsed).toAnchor * FRAME
    }
    return azimuth
  }

  it('leaves the camera to the automatic orbit while no Alert has been raised', () => {
    const released: CameraTouch = { kind: 'released', at: 10 }

    expect(cameraTurn(null, 0.4, never, 50)).toEqual({ toAnchor: 0, orbit: 1 })
    expect(cameraTurn(null, 0.4, { kind: 'holding' }, 50)).toEqual({ toAnchor: 0, orbit: 0 })
    for (const now of [10, 10 + RESUME_DELAY, 10 + RESUME_DELAY + RESUME_RAMP / 2, 60]) {
      expect(cameraTurn(null, 0.4, released, now)).toEqual({ toAnchor: 0, orbit: autoOrbitSpeed(released, now) })
    }
  })

  it('turns toward growing bearings to an anchor that is nearer that way, and stops the orbit', () => {
    const turn = cameraTurn(framing(70 * DEGREE), 10 * DEGREE, never, RAISED + FRAMING_TURN / 2)

    expect(turn.toAnchor).toBeGreaterThan(0)
    expect(turn.orbit).toBe(0)
  })

  it('turns toward smaller bearings to an anchor that is nearer that way', () => {
    expect(cameraTurn(framing(10 * DEGREE), 70 * DEGREE, never, RAISED + FRAMING_TURN / 2).toAnchor).toBeLessThan(0)
  })

  it('takes the shortest way round the back of the site, in both directions', () => {
    const halfway = RAISED + FRAMING_TURN / 2

    expect(cameraTurn(framing(-170 * DEGREE), 170 * DEGREE, never, halfway).toAnchor).toBeGreaterThan(0)
    expect(cameraTurn(framing(170 * DEGREE), -170 * DEGREE, never, halfway).toAnchor).toBeLessThan(0)
    // The orbit has been round several times: the turn is counted from where the camera is seen from.
    expect(cameraTurn(framing(-170 * DEGREE), (170 + 720) * DEGREE, never, halfway).toAnchor).toBeGreaterThan(0)
  })

  it('faces the anchor from its side of the site, however far from the centre it is', () => {
    const near: Framing = { anchor: at(70 * DEGREE, 0.7), since: RAISED }
    const far: Framing = { anchor: at(70 * DEGREE, 2.8), since: RAISED }
    const halfway = RAISED + FRAMING_TURN / 2

    expect(cameraTurn(near, 10 * DEGREE, never, halfway)).toEqual(cameraTurn(far, 10 * DEGREE, never, halfway))
  })

  it('starts without a jerk: still as the Alert is raised, then faster', () => {
    const speeds = [0, 0.1, 0.2, 0.3].map(
      (elapsed) => cameraTurn(framing(90 * DEGREE), 0, never, RAISED + elapsed).toAnchor,
    )

    expect(speeds.at(0)).toBe(0)
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b))
    expect(new Set(speeds).size).toBe(speeds.length)
  })

  it.each([
    ['a short turn toward growing bearings', 10, 55],
    ['a short turn toward smaller bearings', 55, 10],
    ['half a turn', -45, 135],
    ['a turn round the back', 140, -160],
  ])('is on the anchor once the turn is over: %s', (_, from, to) => {
    const whole = Math.abs(shortestTurn(from * DEGREE, to * DEGREE))
    const left = (seconds: number) => Math.abs(shortestTurn(follow(from * DEGREE, to * DEGREE, seconds), to * DEGREE))

    // Slow out and slow in: half of the way at half of the time.
    expect(left(FRAMING_TURN / 2) / whole).toBeCloseTo(0.5, 1)
    expect(left(FRAMING_TURN) / whole).toBeLessThan(0.03)
    expect(left(FRAMING_TURN + 1)).toBeLessThan(0.1 * DEGREE)
  })

  it('never swings past the anchor on the way', () => {
    let azimuth = -45 * DEGREE
    let left = shortestTurn(azimuth, 135 * DEGREE)
    for (let elapsed = 0; elapsed < FRAMED; elapsed += FRAME) {
      azimuth += cameraTurn(framing(135 * DEGREE), azimuth, never, RAISED + elapsed).toAnchor * FRAME
      const now = shortestTurn(azimuth, 135 * DEGREE)

      expect(Math.sign(now) * Math.sign(left)).toBeGreaterThanOrEqual(0)
      expect(Math.abs(now)).toBeLessThanOrEqual(Math.abs(left))
      left = now
    }
  })

  it('stays on the anchor for the hold, the orbit stopped', () => {
    const anchor = 70 * DEGREE

    for (const elapsed of [FRAMING_TURN, FRAMING_TURN + FRAMING_HOLD / 2, FRAMED - FRAME]) {
      const turn = cameraTurn(framing(anchor), anchor, never, RAISED + elapsed)

      expect(turn.toAnchor, `${elapsed} s`).toBeCloseTo(0)
      expect(turn.orbit, `${elapsed} s`).toBe(0)
    }
    // Pushed off it, it comes back.
    expect(cameraTurn(framing(anchor), anchor - 5 * DEGREE, never, RAISED + FRAMING_TURN + 1).toAnchor).toBeGreaterThan(0)
  })

  it('leaves the camera to the orbit after the hold, which picks up speed gradually', () => {
    const anchor = 70 * DEGREE
    const after = (seconds: number) => cameraTurn(framing(anchor), anchor - 20 * DEGREE, never, RAISED + FRAMED + seconds)
    const speeds = [0.1, 0.25, 0.5, 0.75, 0.9].map((share) => after(share * RESUME_RAMP).orbit)

    expect(after(0)).toEqual({ toAnchor: 0, orbit: 0 })
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b))
    expect(new Set(speeds).size).toBe(speeds.length)
    expect(after(RESUME_RAMP / 2).orbit).toBeCloseTo(0.5)
    expect(after(RESUME_RAMP)).toEqual({ toAnchor: 0, orbit: 1 })
    expect(after(3600)).toEqual({ toAnchor: 0, orbit: 1 })
  })

  it('stops at once when the Operator takes the camera', () => {
    for (const elapsed of [0.5, FRAMING_TURN / 2, FRAMING_TURN + 1]) {
      expect(cameraTurn(framing(135 * DEGREE), -45 * DEGREE, { kind: 'holding' }, RAISED + elapsed)).toEqual({
        toAnchor: 0,
        orbit: 0,
      })
    }
  })

  it('does not take the camera back once the Operator lets go: the orbit resumes after its usual delay', () => {
    const released: CameraTouch = { kind: 'released', at: RAISED + 1 }
    const turn = (now: number) => cameraTurn(framing(135 * DEGREE), -45 * DEGREE, released, now)

    for (const now of [released.at, released.at + RESUME_DELAY / 2, released.at + RESUME_DELAY]) {
      expect(turn(now)).toEqual({ toAnchor: 0, orbit: 0 })
    }
    expect(turn(released.at + RESUME_DELAY + RESUME_RAMP / 2).orbit).toBeCloseTo(0.5)
    expect(turn(released.at + RESUME_DELAY + RESUME_RAMP)).toEqual({ toAnchor: 0, orbit: 1 })
    // Not held back by the hold it would have been on.
    expect(RAISED + FRAMED).toBeGreaterThan(released.at + RESUME_DELAY + RESUME_RAMP)
  })

  it('turns to an Alert raised after the Operator let go, even within the idle delay', () => {
    const released: CameraTouch = { kind: 'released', at: RAISED - 1 }
    const turn = cameraTurn(framing(70 * DEGREE), 10 * DEGREE, released, RAISED + FRAMING_TURN / 2)

    expect(turn.toAnchor).toBeGreaterThan(0)
    expect(turn.orbit).toBe(0)
    expect(Math.abs(shortestTurn(follow(10 * DEGREE, 70 * DEGREE, FRAMING_TURN + 1, released), 70 * DEGREE))).toBeLessThan(
      0.1 * DEGREE,
    )
  })

  it('leaves alone an Alert raised while the Operator holds the camera, after they let go too', () => {
    const released: CameraTouch = { kind: 'released', at: RAISED + 0.5 }

    expect(cameraTurn(framing(70 * DEGREE), 10 * DEGREE, { kind: 'holding' }, RAISED).toAnchor).toBe(0)
    expect(cameraTurn(framing(70 * DEGREE), 10 * DEGREE, released, RAISED + 1).toAnchor).toBe(0)
  })

  it('goes to a more recent Alert from wherever the first one left the camera', () => {
    const first = framing(70 * DEGREE)
    const second: Framing = { anchor: at(-20 * DEGREE), since: RAISED + 3 }
    const now = RAISED + 3 + FRAMING_TURN / 2

    // Held on the first anchor, it would not move: the second one takes it the other way.
    expect(cameraTurn(first, 70 * DEGREE, never, now).toAnchor).toBeCloseTo(0)
    expect(cameraTurn(second, 70 * DEGREE, never, now).toAnchor).toBeLessThan(0)
  })
})
