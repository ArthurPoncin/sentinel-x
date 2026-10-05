import { describe, expect, it } from 'vitest'
import { FADE_SECONDS, fadeTo, fadeValue, settled } from './fade'

// Red, green, blue.
const NEUTRAL = [1, 1, 1]
const RED = [1, 0.08, 0.08]
const AMBER = [0.9, 0.4, 0]

const STARTED_AT = 10
const FRAME = 1 / 60

// The same color, give or take what adding up times and channels leaves behind.
const near = (color: readonly number[]) => color.map((channel) => expect.closeTo(channel, 9))

describe('a fade', () => {
  it('takes less than a second', () => {
    expect(FADE_SECONDS).toBeGreaterThan(0)
    expect(FADE_SECONDS).toBeLessThan(1)
  })

  it('shows a settled color as it is, whenever it is read', () => {
    expect(fadeValue(settled(RED), 0)).toEqual(RED)
    expect(fadeValue(settled(RED), 3600)).toEqual(RED)
  })

  it('goes from the color on screen to the new one, and stays there', () => {
    const fade = fadeTo(settled(NEUTRAL), RED, STARTED_AT)

    expect(fadeValue(fade, STARTED_AT)).toEqual(NEUTRAL)
    expect(fadeValue(fade, STARTED_AT + FADE_SECONDS / 2)).toEqual(near([1, 0.54, 0.54]))
    expect(fadeValue(fade, STARTED_AT + FADE_SECONDS)).toEqual(near(RED))
    expect(fadeValue(fade, STARTED_AT + 3600)).toEqual(RED)
  })

  it('gets there without a cut, gently at both ends', () => {
    const fade = fadeTo(settled([0]), [1], STARTED_AT)
    const frames = Math.round(FADE_SECONDS / FRAME)
    const shown = Array.from({ length: frames + 1 }, (_, frame) => fadeValue(fade, STARTED_AT + frame * FRAME)[0] ?? 0)
    const steps = shown.slice(1).map((level, frame) => level - (shown[frame] ?? 0))
    const widest = Math.max(...steps)

    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0)
    expect(widest).toBeLessThan(0.05)
    expect(steps.at(0)).toBeLessThan(widest / 4)
    expect(steps.at(-1)).toBeLessThan(widest / 4)
  })

  it('starts again from the color on screen when the target changes on the way', () => {
    const toRed = fadeTo(settled(NEUTRAL), RED, STARTED_AT)
    const changedAt = STARTED_AT + FADE_SECONDS / 3
    const onScreen = fadeValue(toRed, changedAt)

    const toAmber = fadeTo(toRed, AMBER, changedAt)

    expect(onScreen).not.toEqual(near(NEUTRAL))
    expect(onScreen).not.toEqual(near(RED))
    expect(fadeValue(toAmber, changedAt)).toEqual(onScreen)
    expect(fadeValue(toAmber, changedAt + FRAME)).toEqual(onScreen.map((channel) => expect.closeTo(channel, 2)))
    expect(fadeValue(toAmber, changedAt + FADE_SECONDS)).toEqual(near(AMBER))
  })

  it('takes a whole fade from there, not what was left of the first one', () => {
    const toRed = fadeTo(settled(NEUTRAL), RED, STARTED_AT)
    const toAmber = fadeTo(toRed, AMBER, STARTED_AT + FADE_SECONDS / 2)

    expect(fadeValue(toAmber, STARTED_AT + FADE_SECONDS)).not.toEqual(near(AMBER))
    expect(fadeValue(toAmber, STARTED_AT + FADE_SECONDS * 1.5)).toEqual(near(AMBER))
  })

  it('is not started over by asking for the color it already goes to', () => {
    const fade = fadeTo(settled(NEUTRAL), RED, STARTED_AT)

    expect(fadeTo(fade, [...RED], STARTED_AT + FADE_SECONDS / 2)).toBe(fade)
    expect(fadeTo(settled(RED), [...RED], STARTED_AT)).toEqual(settled(RED))
  })

  it('fades a single level like it fades a color', () => {
    const fade = fadeTo(settled([1]), [0], STARTED_AT)

    expect(fadeValue(fade, STARTED_AT)).toEqual([1])
    expect(fadeValue(fade, STARTED_AT + FADE_SECONDS / 2)).toEqual(near([0.5]))
    expect(fadeValue(fade, STARTED_AT + FADE_SECONDS)).toEqual(near([0]))
  })

  it('does not change the fade it is given', () => {
    const fade = fadeTo(settled(NEUTRAL), RED, STARTED_AT)
    const copy = structuredClone(fade)

    fadeValue(fade, STARTED_AT + FADE_SECONDS / 2)
    fadeTo(fade, AMBER, STARTED_AT + FADE_SECONDS / 2)

    expect(fade).toEqual(copy)
  })
})
