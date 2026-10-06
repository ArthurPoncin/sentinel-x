import type { StatusLevel } from '@/shared/contract'
import { FADE_SECONDS } from './fade'

// Seconds the whole model is lit in the Status's color once the Status has risen, the fade that brings the
// color in included: long enough not to miss the escalation, short enough to then see what set it off.
export const FLASH_HOLD = 2

// The share of the Status's color the light keeps once the flash is over: a slight tint, so the signals, which
// are in the same hue, stand out of the scene. None when nominal: the studio's own light.
export const REST_SHARE: Readonly<Record<StatusLevel, number>> = { nominal: 0, elevated: 0.12, critical: 0.12 }

// The Status levels, from the lowest up.
const LEVELS: readonly StatusLevel[] = ['nominal', 'elevated', 'critical']

const unit = (value: number) => Math.min(1, Math.max(0, value))
const smoothstep = (share: number) => share * share * (3 - 2 * share)

// Whether a Status that goes from `from` to `to` rises.
export function rises(from: StatusLevel, to: StatusLevel): boolean {
  return LEVELS.indexOf(to) > LEVELS.indexOf(from)
}

// The share of the Status's color in the light, 0–1, `elapsed` seconds after the Status went from `from` to
// `to`. A Status that rises floods the light: all of it for FLASH_HOLD, then back to the tint it rests in,
// over a fade. One that goes down, or stays, does not flash: the light is at rest.
export function statusShare(from: StatusLevel, to: StatusLevel, elapsed: number): number {
  const rest = REST_SHARE[to]
  if (!rises(from, to)) return rest
  return 1 + (rest - 1) * smoothstep(unit((elapsed - FLASH_HOLD) / FADE_SECONDS))
}

// How much of each Status's color is in the light, 0–1 each: what is left of it is the studio's neutral light.
export type LightShares = Readonly<Record<StatusLevel, number>>

// The light on its way through a change of Status. `startedAt` is in seconds, on a clock that only goes forward.
export interface StatusLight {
  // What was on screen as the Status changed.
  from: LightShares
  // The Status it left, and the one it shows.
  previous: StatusLevel
  level: StatusLevel
  startedAt: number
}

function only(level: StatusLevel, share: number): LightShares {
  return { nominal: 0, elevated: 0, critical: 0, [level]: share }
}

// The light of a Status that was there all along: at rest, without a flash. What the Twin opens on.
export function resting(level: StatusLevel): StatusLight {
  return { from: only(level, REST_SHARE[level]), previous: level, level, startedAt: Number.NEGATIVE_INFINITY }
}

// What the light shows at `now`: it leaves what was on screen for the share its Status asks for over
// FADE_SECONDS, like every change in the Twin, so the flash fades in too.
export function lightShares(light: StatusLight, now: number): LightShares {
  const elapsed = now - light.startedAt
  const faded = smoothstep(unit(elapsed / FADE_SECONDS))
  const asked = only(light.level, statusShare(light.previous, light.level, elapsed))
  const share = (level: StatusLevel) => light.from[level] * (1 - faded) + asked[level] * faded
  return { nominal: share('nominal'), elevated: share('elevated'), critical: share('critical') }
}

// The light as the Status becomes `level` at `now`, from what is shown then: a Status that rises during a
// flash floods the model in its own color from the one on screen, without a jump. A light that already shows
// that Status is returned as it is: asking twice does not flash twice.
export function lightTo(light: StatusLight, level: StatusLevel, now: number): StatusLight {
  if (level === light.level) return light
  return { from: lightShares(light, now), previous: light.level, level, startedAt: now }
}

// The light's color for `shares`, channel by channel: each Status's color for its share, the studio's
// `neutral` for what is left.
export function lit(
  shares: LightShares,
  neutral: readonly number[],
  colors: Readonly<Record<StatusLevel, readonly number[]>>,
): number[] {
  const left = 1 - LEVELS.reduce((sum, level) => sum + shares[level], 0)
  return neutral.map((channel, index) =>
    LEVELS.reduce((sum, level) => sum + shares[level] * (colors[level][index] ?? 0), channel * left),
  )
}
