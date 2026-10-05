import type { Alert, StatusLevel, Telemetry } from '@/shared/contract'
import { gasLevel } from './gas-level'

// What the Twin reads of the live feed: the fields of the live-feed state it needs, by shape, so
// the route hands them over without the twin feature importing live-feed.
export interface TwinState {
  status: StatusLevel
  latestTelemetry: Telemetry | null
  activeAlerts: readonly Alert[]
}

// The overall color grade the Status gives the scene.
export interface StatusGrade {
  level: StatusLevel
  // The sky behind the Outpost.
  background: string
  // The light that fills the scene.
  light: string
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
}

// Dark anodized metal: the Enclosure's body when the air is calm.
export const CALM_COLOR = '#2c343e'
export const GAS_COLOR = '#ff4d4f'

export const STATUS_GRADES: Readonly<Record<StatusLevel, StatusGrade>> = {
  nominal: { level: 'nominal', background: '#0b0f14', light: '#ffffff', perimeter: '#3ecf8e' },
  elevated: { level: 'elevated', background: '#16110a', light: '#ffe2b0', perimeter: '#f5a623' },
  critical: { level: 'critical', background: '#1a0a0b', light: '#ffc2c2', perimeter: '#ff4d4f' },
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
  }
}
