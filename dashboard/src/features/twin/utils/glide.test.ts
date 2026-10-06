import { describe, expect, it } from 'vitest'
import { GLIDE, glide, type Track, trackAt } from './glide'

const FRAME = 1 / 60

// Plays `seconds` of frames from `current` toward `target`, and returns each position on screen.
function frames(current: number, target: number, seconds: number): number[] {
  const shown = [current]
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) {
    shown.push(glide(shown.at(-1) ?? current, target, FRAME))
  }
  return shown
}

describe('the glide', () => {
  it('does not move when no time has gone by, nor when it is already there', () => {
    expect(glide(0.15, 0.35, 0)).toBe(0.15)
    expect(glide(0.35, 0.35, 1)).toBe(0.35)
  })

  it('moves toward the target, slowing as it gets there, without overshooting', () => {
    const shown = frames(0.15, 0.35, 1)
    const steps = shown.slice(1).map((place, frame) => place - (shown[frame] ?? 0))

    expect(steps.every((step) => step > 0)).toBe(true)
    expect(steps).toEqual([...steps].sort((a, b) => b - a))
    expect(shown.every((place) => place <= 0.35)).toBe(true)
  })

  it('goes the other way just as well', () => {
    const shown = frames(0.75, 0.15, 1)
    expect(shown.every((place) => place >= 0.15 && place <= 0.75)).toBe(true)
    expect(shown.at(-1)).toBeCloseTo(0.15, 2)
  })

  it('glides, it does not jump: no frame covers more than a tenth of the way', () => {
    const shown = frames(0.15, 0.35, 1)
    const widest = Math.max(...shown.slice(1).map((place, frame) => place - (shown[frame] ?? 0)))
    expect(widest).toBeLessThan(0.1 * (0.35 - 0.15))
  })

  it('is all but there before the next x_norm comes, a second later', () => {
    // On the mock feed: 0.15, 0.35, 0.55, 0.75, one a second.
    expect(glide(0.15, 0.35, 0.5)).toBeGreaterThan(0.15 + 0.9 * 0.2)
    expect(glide(0.15, 0.35, 1)).toBeCloseTo(0.35, 2)
    expect(GLIDE).toBeGreaterThan(0)
  })

  it('is the same whatever the frame rate', () => {
    const atSixty = frames(0.15, 0.35, 0.5).at(-1)
    const atThirty = glide(glide(0.15, 0.35, 0.25), 0.35, 0.25)
    expect(atSixty).toBeCloseTo(atThirty, 9)
    expect(glide(0.15, 0.35, 0.5)).toBeCloseTo(atThirty, 9)
  })

  it('does not go back when the clock does', () => {
    expect(glide(0.15, 0.35, -1)).toBe(0.15)
  })
})

describe("the intruder's track", () => {
  const seen = (alertId: string, x_norm: number) => ({ alertId, x_norm })

  it('is nothing until an intruder is seen', () => {
    expect(trackAt(null, null, FRAME)).toBeNull()
  })

  it('stands the column where a newly raised intruder is, without gliding there', () => {
    expect(trackAt(null, seen('i1', 0.55), FRAME)).toEqual({ alertId: 'i1', x_norm: 0.55 })
  })

  it("glides along the arc as the same Alert's x_norm changes", () => {
    const first = trackAt(null, seen('i1', 0.15), FRAME)
    const next = trackAt(first, seen('i1', 0.35), FRAME)

    expect(next?.alertId).toBe('i1')
    expect(next?.x_norm).toBeGreaterThan(0.15)
    expect(next?.x_norm).toBeLessThan(0.35)
    expect(next?.x_norm).toBe(glide(0.15, 0.35, FRAME))
  })

  it('stays where it last stood once cleared, so the column fades out there', () => {
    const shown: Track = { alertId: 'i1', x_norm: 0.62 }
    const cleared = trackAt(shown, null, FRAME)

    expect(cleared).toEqual({ alertId: null, x_norm: 0.62 })
    expect(trackAt(cleared, null, FRAME)).toBe(cleared)
  })

  it('does not glide from where a previous intruder stood, even one raised again under the same id', () => {
    const cleared = trackAt({ alertId: 'intruder', x_norm: 0.75 }, null, FRAME)
    expect(trackAt(cleared, seen('intruder', 0.15), FRAME)).toEqual({ alertId: 'intruder', x_norm: 0.15 })
  })

  it('stands the column where another Alert, raised while the first is active, sees its intruder', () => {
    expect(trackAt({ alertId: 'i1', x_norm: 0.2 }, seen('i2', 0.7), FRAME)).toEqual({ alertId: 'i2', x_norm: 0.7 })
  })
})
