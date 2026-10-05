import { STATUS_COLORS } from '@/shared/config/status-colors'
import type { Alert, StatusLevel, Telemetry } from '@/shared/contract'
import { gasLevel } from './gas-level'

// What the Twin reads of the live feed: the fields of the live-feed state it needs, by shape, so
// the route hands them over without the twin feature importing live-feed.
export interface TwinState {
  // The feed's connection as it is now, and whether it has been open at least once.
  connection: 'connecting' | 'open' | 'closed'
  connectedOnce: boolean
  status: StatusLevel
  latestTelemetry: Telemetry | null
  activeAlerts: readonly Alert[]
}

// The overall color grade the Status gives the scene.
export interface StatusGrade {
  level: StatusLevel
  // The sky behind the Outpost.
  background: string
  // The light from the front and above: neutral when nominal, the Status's color otherwise.
  light: string
  // The light from behind, on the edges: the studio's cold one when nominal, the Status's color otherwise.
  rim: string
  // The ring that marks the perimeter.
  perimeter: string
}

export interface SceneProps {
  enclosure: {
    // The body's color, from dark anodized when calm to red at critical gas.
    color: string
    // How bright it glows and lights the ground around it, 0–1: the gas level.
    glow: number
    // What the LCD band shows, the Status, and the color it shows it in.
    lcd: { text: string; color: string }
    // The color the LED ring breathes in: the Status's.
    ring: { color: string }
  }
  status: StatusGrade
  // The signals an active `predictive` Alert says are drifting (its `drivers`), each once.
  pulses: readonly string[]
  // Where the last raised of the active `intrusion` Alerts places the intruder, 0 = left, 1 = right.
  intruder: { x_norm: number } | null
  // The feed was open and no longer is: the scene shows what it last knew, not the Outpost as it is now.
  signalLost: boolean
}

// Dark anodized metal: the Enclosure's body when the air is calm.
export const CALM_COLOR = '#2c343e'
export const GAS_COLOR = STATUS_COLORS.critical
// The studio's own light, when nothing is wrong: white from the front, cold from behind. Color is kept for
// the Status.
export const NEUTRAL_LIGHT = '#ffffff'
export const NEUTRAL_RIM = '#9dbcff'

// A Status that is not nominal colors every light: the whole model is lit in it, whatever side it is seen from.
function inStatusColor(level: Exclude<StatusLevel, 'nominal'>, background: string): StatusGrade {
  const color = STATUS_COLORS[level]
  return { level, background, light: color, rim: color, perimeter: color }
}

export const STATUS_GRADES: Readonly<Record<StatusLevel, StatusGrade>> = {
  nominal: {
    level: 'nominal',
    background: '#0b0f14',
    light: NEUTRAL_LIGHT,
    rim: NEUTRAL_RIM,
    perimeter: STATUS_COLORS.nominal,
  },
  elevated: inStatusColor('elevated', '#16110a'),
  critical: inStatusColor('critical', '#1a0a0b'),
}

function channels(color: string): number[] {
  const value = Number.parseInt(color.slice(1), 16)
  return [16, 8, 0].map((shift) => (value >> shift) & 0xff)
}

// The color `share` of the way from `from` to `to`, both `#rrggbb`.
export function mix(from: string, to: string, share: number): string {
  const end = channels(to)
  const mixed = channels(from).map((start, i) => Math.round(start + ((end[i] ?? start) - start) * share))
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

// What the Enclosure's LCD reads for each Status, as the real one does.
export const LCD_TEXT: Readonly<Record<StatusLevel, string>> = {
  nominal: 'NOMINAL',
  elevated: 'ELEVATED',
  critical: 'CRITICAL',
}

// The live state as the scene shows it: pure, no WebGL, so it is tested without a render.
export function toScene(state: TwinState): SceneProps {
  const glow = gasLevel(state.latestTelemetry?.readings.air ?? null)
  const pulses = new Set<string>()
  let intruder: SceneProps['intruder'] = null
  for (const alert of state.activeAlerts) {
    if (alert.kind === 'predictive') for (const driver of alert.detail.drivers) pulses.add(driver)
    if (alert.kind === 'intrusion') intruder = { x_norm: alert.detail.x_norm }
  }

  const status = STATUS_GRADES[state.status]

  return {
    enclosure: {
      color: mix(CALM_COLOR, GAS_COLOR, glow),
      glow,
      lcd: { text: LCD_TEXT[state.status], color: status.perimeter },
      ring: { color: status.perimeter },
    },
    status,
    pulses: [...pulses],
    intruder,
    // Not open is not enough: before the first connection, and while that one is still being tried,
    // there is no signal to have lost. After it, a retry in progress is still a signal lost.
    signalLost: state.connectedOnce && state.connection !== 'open',
  }
}
