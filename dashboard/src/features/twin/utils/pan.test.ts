import { describe, expect, it } from 'vitest'
import { PAN_PULL, panToward } from './pan'

const FRAME = 1 / 60

// The camera on every frame of `seconds`, from `shown`, on its way to `pan`.
function turning(shown: number, pan: number, seconds: number, rate = 60): number[] {
  const drawn: number[] = []
  let now = shown
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) {
    now = panToward(now, pan, 1 / rate)
    drawn.push(now)
  }
  return drawn
}

describe("the camera's pan as the Twin draws it", () => {
  it('stays where it is while the camera is where it is drawn', () => {
    expect(panToward(0, 0, FRAME)).toBe(0)
    expect(panToward(0.7, 0.7, 1)).toBe(0.7)
  })

  it('turns to where the Alert says the camera is, without a jump, and ends right on it', () => {
    const drawn = turning(0, 1, 3)
    const steps = drawn.map((pan, frame) => pan - (drawn[frame - 1] ?? 0))

    expect(drawn[0]).toBeGreaterThan(0)
    expect(drawn).toEqual([...drawn].sort((a, b) => a - b))
    expect(Math.max(...steps)).toBeLessThan(0.1)
    expect(drawn.at(-1)).toBe(1)
  })

  it('is most of the way there in a few tenths of a second: before the next Alert tells it again', () => {
    expect(turning(0, 1, 0.5).at(-1)).toBeGreaterThan(0.9)
    expect(PAN_PULL).toBeGreaterThan(0)
  })

  it('turns the other way just as well, and back to rest once the intrusion is cleared', () => {
    expect(turning(0, -1, 3)).toEqual(turning(0, 1, 3).map((pan) => -pan))
    expect(turning(-0.8, 0, 3).at(-1)).toBe(0)
  })

  it('is the same whatever the frame rate, and does not go back when the clock does', () => {
    const atSixty = turning(0, 1, 0.5, 60).at(-1) ?? Number.NaN

    expect(turning(0, 1, 0.5, 30).at(-1)).toBeCloseTo(atSixty, 9)
    expect(panToward(0, 1, 0.5)).toBeCloseTo(atSixty, 9)
    expect(panToward(0.4, 1, -1)).toBe(0.4)
  })
})
