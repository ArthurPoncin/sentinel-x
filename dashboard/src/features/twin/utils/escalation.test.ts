import { describe, expect, it } from 'vitest'
import type { StatusLevel } from '@/shared/contract'
import {
  FLASH_HOLD,
  type LightShares,
  lightShares,
  lightTo,
  lit,
  REST_SHARE,
  resting,
  rises,
  type StatusLight,
  statusShare,
} from './escalation'
import { FADE_SECONDS } from './fade'

// The instant the Status changes, on the frames' clock.
const CHANGED = 10
const FRAME = 1 / 60
// The flash, from the Status rising to the light back at rest.
const FLASH = FLASH_HOLD + FADE_SECONDS

const RISES = [
  ['nominal', 'elevated'],
  ['elevated', 'critical'],
  ['nominal', 'critical'],
] as const
const DESCENTS = [
  ['critical', 'elevated'],
  ['elevated', 'nominal'],
  ['critical', 'nominal'],
] as const
const LEVELS = ['nominal', 'elevated', 'critical'] as const

const none: LightShares = { nominal: 0, elevated: 0, critical: 0 }
// The same shares, give or take what adding up times leaves behind.
const near = (shares: Partial<LightShares>, digits = 9) => ({
  nominal: expect.closeTo(shares.nominal ?? 0, digits),
  elevated: expect.closeTo(shares.elevated ?? 0, digits),
  critical: expect.closeTo(shares.critical ?? 0, digits),
})

// Plays the changes of Status `events` gives, oldest first, on a Twin that opened at `opened`.
function play(opened: StatusLevel, events: readonly (readonly [now: number, level: StatusLevel])[]): StatusLight {
  return events.reduce((light, [now, level]) => lightTo(light, level, now), resting(opened))
}

describe('statusShare', () => {
  it('holds the flash for 2 seconds', () => {
    expect(FLASH_HOLD).toBe(2)
  })

  it('rests in a slight tint of the Status, and in none when nominal', () => {
    expect(REST_SHARE.nominal).toBe(0)
    for (const level of ['elevated', 'critical'] as const) {
      expect(REST_SHARE[level]).toBeGreaterThan(0)
      expect(REST_SHARE[level]).toBeLessThan(0.25)
    }
  })

  it.each(RISES)('floods the light in the color of the Status as it rises from %s to %s', (from, to) => {
    expect(statusShare(from, to, 0)).toBe(1)
    expect(statusShare(from, to, FLASH_HOLD / 2)).toBe(1)
    expect(statusShare(from, to, FLASH_HOLD)).toBe(1)
  })

  it.each(RISES)('goes back to the tint it rests in once the flash from %s to %s is held', (from, to) => {
    const halfway = statusShare(from, to, FLASH_HOLD + FADE_SECONDS / 2)

    expect(halfway).toBeCloseTo((1 + REST_SHARE[to]) / 2)
    expect(statusShare(from, to, FLASH)).toBeCloseTo(REST_SHARE[to])
    expect(statusShare(from, to, 3600)).toBe(REST_SHARE[to])
    expect(statusShare(from, to, Number.POSITIVE_INFINITY)).toBe(REST_SHARE[to])
  })

  it('goes back without a cut, gently at both ends', () => {
    const frames = Math.round(FLASH / FRAME)
    const shown = Array.from({ length: frames + 1 }, (_, frame) => statusShare('nominal', 'critical', frame * FRAME))
    const steps = shown.slice(1).map((share, frame) => (shown[frame] ?? 0) - share)
    const widest = Math.max(...steps)

    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0)
    expect(widest).toBeLessThan(0.05)
    expect(steps.at(-1)).toBeLessThan(widest / 4)
  })

  it.each(DESCENTS)('does not flash as the Status goes down from %s to %s', (from, to) => {
    for (const elapsed of [0, FRAME, FADE_SECONDS, FLASH_HOLD, FLASH, 3600]) {
      expect(statusShare(from, to, elapsed), `after ${elapsed} s`).toBe(REST_SHARE[to])
    }
  })

  it.each(LEVELS)('does not flash for a Status that stays %s', (level) => {
    expect(statusShare(level, level, 0)).toBe(REST_SHARE[level])
    expect(statusShare(level, level, FLASH_HOLD / 2)).toBe(REST_SHARE[level])
  })

  it('tells a Status that rises from one that goes down or stays', () => {
    for (const [from, to] of RISES) expect(rises(from, to), `${from} → ${to}`).toBe(true)
    for (const [from, to] of DESCENTS) expect(rises(from, to), `${from} → ${to}`).toBe(false)
    for (const level of LEVELS) expect(rises(level, level), level).toBe(false)
  })
})

describe('the light of the Status', () => {
  it.each(LEVELS)('opens at rest on a Twin that opens %s, without a flash', (level) => {
    const light = resting(level)

    expect(lightShares(light, 0)).toEqual({ ...none, [level]: REST_SHARE[level] })
    expect(lightShares(light, 3600)).toEqual({ ...none, [level]: REST_SHARE[level] })
  })

  it('fades the flash in from the neutral light, holds it, then goes back to rest', () => {
    const light = play('nominal', [[CHANGED, 'critical']])

    expect(lightShares(light, CHANGED)).toEqual(none)
    expect(lightShares(light, CHANGED + FADE_SECONDS / 2)).toEqual(near({ critical: 0.5 }))
    expect(lightShares(light, CHANGED + FADE_SECONDS)).toEqual(near({ critical: 1 }))
    expect(lightShares(light, CHANGED + FLASH_HOLD)).toEqual(near({ critical: 1 }))
    expect(lightShares(light, CHANGED + FLASH)).toEqual(near({ critical: REST_SHARE.critical }))
    expect(lightShares(light, CHANGED + 3600)).toEqual({ ...none, critical: REST_SHARE.critical })
  })

  it('floods the light from the tint of the Status it leaves as it rises from elevated to critical', () => {
    const light = play('elevated', [[CHANGED, 'critical']])

    expect(lightShares(light, CHANGED)).toEqual({ ...none, elevated: REST_SHARE.elevated })
    expect(lightShares(light, CHANGED + FADE_SECONDS)).toEqual(near({ critical: 1 }))
  })

  it('starts a rise that comes during a flash from what is on screen, without a jump', () => {
    const risenAgain = CHANGED + FLASH_HOLD / 2
    const flashing = play('nominal', [[CHANGED, 'elevated']])
    const onScreen = lightShares(flashing, risenAgain)

    const light = lightTo(flashing, 'critical', risenAgain)

    expect(onScreen).toEqual(near({ elevated: 1 }))
    expect(lightShares(light, risenAgain)).toEqual(onScreen)
    expect(lightShares(light, risenAgain + FRAME)).toEqual(near(onScreen, 2))
    expect(lightShares(light, risenAgain + FADE_SECONDS / 2)).toEqual(near({ elevated: 0.5, critical: 0.5 }))
    expect(lightShares(light, risenAgain + FADE_SECONDS)).toEqual(near({ critical: 1 }))
  })

  it('starts a rise that comes as a flash fades in from what is on screen too', () => {
    const risenAgain = CHANGED + FADE_SECONDS / 3
    const fadingIn = play('nominal', [[CHANGED, 'elevated']])
    const onScreen = lightShares(fadingIn, risenAgain)

    const light = lightTo(fadingIn, 'critical', risenAgain)

    expect(onScreen.elevated).toBeGreaterThan(0)
    expect(onScreen.elevated).toBeLessThan(1)
    expect(lightShares(light, risenAgain)).toEqual(onScreen)
    expect(lightShares(light, risenAgain + FRAME)).toEqual(near(onScreen, 2))
  })

  it('holds the flash of a rise that comes during another for its own 2 seconds', () => {
    const risenAgain = CHANGED + FLASH_HOLD / 2
    const light = play('nominal', [
      [CHANGED, 'elevated'],
      [risenAgain, 'critical'],
    ])

    expect(lightShares(light, CHANGED + FLASH)).toEqual(near({ critical: 1 }))
    expect(lightShares(light, risenAgain + FLASH_HOLD)).toEqual(near({ critical: 1 }))
    expect(lightShares(light, risenAgain + FLASH)).toEqual(near({ critical: REST_SHARE.critical }))
  })

  it('does not flash as the Status goes down: the light fades to the tint of the new one', () => {
    const light = play('critical', [[CHANGED, 'elevated']])
    const frames = Math.round(FLASH / FRAME)

    expect(lightShares(light, CHANGED)).toEqual({ ...none, critical: REST_SHARE.critical })
    for (let frame = 0; frame <= frames; frame++) {
      expect(lightShares(light, CHANGED + frame * FRAME).elevated).toBeLessThanOrEqual(REST_SHARE.elevated)
    }
    expect(lightShares(light, CHANGED + FADE_SECONDS)).toEqual(near({ elevated: REST_SHARE.elevated }))
  })

  it('fades a flash out when the Status goes down during it, and flashes nothing of the new one', () => {
    const wentDown = CHANGED + FLASH_HOLD / 2
    const light = play('nominal', [
      [CHANGED, 'critical'],
      [wentDown, 'elevated'],
    ])

    expect(lightShares(light, wentDown)).toEqual(near({ critical: 1 }))
    expect(lightShares(light, wentDown + FADE_SECONDS / 2)).toEqual(
      near({ critical: 0.5, elevated: REST_SHARE.elevated / 2 }),
    )
    expect(lightShares(light, wentDown + FADE_SECONDS)).toEqual(near({ elevated: REST_SHARE.elevated }))
    expect(lightShares(light, wentDown + FLASH_HOLD)).toEqual(near({ elevated: REST_SHARE.elevated }))
  })

  it('goes back to the neutral light as the Status goes back to nominal', () => {
    const light = play('elevated', [[CHANGED, 'nominal']])

    expect(lightShares(light, CHANGED + FADE_SECONDS)).toEqual(near(none))
  })

  it('flashes again when the Status rises again', () => {
    const light = play('critical', [
      [CHANGED, 'elevated'],
      [CHANGED + 5, 'critical'],
    ])

    expect(lightShares(light, CHANGED + 5 + FADE_SECONDS)).toEqual(near({ critical: 1 }))
  })

  it('is not started over by the Status it already shows', () => {
    const light = play('nominal', [[CHANGED, 'critical']])

    expect(lightTo(light, 'critical', CHANGED + FLASH_HOLD / 2)).toBe(light)
    expect(lightTo(resting('elevated'), 'elevated', CHANGED)).toEqual(resting('elevated'))
  })

  it('never shows more than the whole light, nor any of a color in the negative', () => {
    const light = play('nominal', [
      [CHANGED, 'elevated'],
      [CHANGED + 0.3, 'critical'],
      [CHANGED + 1.1, 'elevated'],
      [CHANGED + 1.4, 'critical'],
    ])

    for (let frame = 0; frame <= 6 / FRAME; frame++) {
      const shares = lightShares(light, CHANGED + 1.4 + frame * FRAME)
      const whole = shares.nominal + shares.elevated + shares.critical

      expect(Math.min(shares.nominal, shares.elevated, shares.critical)).toBeGreaterThanOrEqual(0)
      expect(whole).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('does not change the light it is given', () => {
    const light = play('nominal', [[CHANGED, 'elevated']])
    const copy = structuredClone(light)

    lightShares(light, CHANGED + FADE_SECONDS / 2)
    lightTo(light, 'critical', CHANGED + FADE_SECONDS / 2)

    expect(light).toEqual(copy)
  })
})

describe('lit', () => {
  // Red, green, blue.
  const NEUTRAL = [1, 1, 1]
  const COLORS = { nominal: [0, 0.6, 0.3], elevated: [0.9, 0.4, 0], critical: [1, 0.08, 0.08] }

  it('is the neutral light when no Status has a share in it', () => {
    expect(lit(none, NEUTRAL, COLORS)).toEqual(NEUTRAL)
  })

  it('is the color of the Status that has the whole of it', () => {
    expect(lit({ ...none, critical: 1 }, NEUTRAL, COLORS)).toEqual(COLORS.critical)
    expect(lit({ ...none, elevated: 1 }, NEUTRAL, COLORS)).toEqual(COLORS.elevated)
  })

  it('mixes the neutral light and the color of each Status by its share', () => {
    const mixed = lit({ ...none, critical: 0.5 }, NEUTRAL, COLORS)
    const between = lit({ nominal: 0, elevated: 0.5, critical: 0.5 }, NEUTRAL, COLORS)

    expect(mixed).toEqual([1, 0.54, 0.54].map((channel) => expect.closeTo(channel, 9)))
    expect(between).toEqual([0.95, 0.24, 0.04].map((channel) => expect.closeTo(channel, 9)))
  })

  it('stays close to the neutral light at rest', () => {
    const rested = lit({ ...none, critical: REST_SHARE.critical }, NEUTRAL, COLORS)

    for (const channel of rested) expect(channel).toBeGreaterThan(0.75)
    expect(rested[0]).toBeGreaterThan(rested[1] ?? 1)
  })
})
