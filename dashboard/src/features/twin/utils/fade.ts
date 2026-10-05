// Seconds a change takes to show in full. Nothing in the Twin cuts: it fades, in under a second.
export const FADE_SECONDS = 0.8

// A value on its way to another, channel by channel: the red, green and blue of a color, or a single level.
// `startedAt` is in seconds, on a clock that only goes forward.
export interface Fade {
  from: readonly number[]
  to: readonly number[]
  startedAt: number
}

// A value that is going nowhere: what a fade starts from.
export function settled(value: readonly number[]): Fade {
  return { from: value, to: value, startedAt: Number.NEGATIVE_INFINITY }
}

// What the fade shows at `now`: `from` as it starts, `to` from FADE_SECONDS on, and in between a pace that
// picks up then slows down, so that neither end of the fade shows.
export function fadeValue(fade: Fade, now: number): number[] {
  const share = Math.min(1, Math.max(0, (now - fade.startedAt) / FADE_SECONDS))
  const eased = share * share * (3 - 2 * share)
  return fade.from.map((start, channel) => start * (1 - eased) + (fade.to[channel] ?? start) * eased)
}

// The fade to `to` from what is shown at `now`: a change that comes during a fade starts from the value on
// screen, without a jump. A fade that already goes there is returned as it is: asking twice does not restart it.
export function fadeTo(fade: Fade, to: readonly number[], now: number): Fade {
  if (to.length === fade.to.length && to.every((value, channel) => value === fade.to[channel])) return fade
  return { from: fadeValue(fade, now), to, startedAt: now }
}
