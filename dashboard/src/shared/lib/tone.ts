import type { Severity, StatusLevel } from '@/shared/contract'

// One color per level, the same on the badge, the Alerts and the charts: green, amber, red.
export type Tone = 'nominal' | 'elevated' | 'critical'

export const toneOfStatus: Record<StatusLevel, Tone> = { nominal: 'nominal', elevated: 'elevated', critical: 'critical' }
export const toneOfSeverity: Record<Severity, Tone> = { info: 'nominal', warning: 'elevated', critical: 'critical' }

// Full class names, so Tailwind finds them in the source.
export const toneText: Record<Tone, string> = {
  nominal: 'text-nominal',
  elevated: 'text-elevated',
  critical: 'text-critical',
}

export const toneSurface: Record<Tone, string> = {
  nominal: 'border-nominal/40 bg-nominal/10 text-nominal',
  elevated: 'border-elevated/40 bg-elevated/10 text-elevated',
  critical: 'border-critical/50 bg-critical/15 text-critical',
}

export const toneDot: Record<Tone, string> = {
  nominal: 'bg-nominal',
  elevated: 'bg-elevated',
  critical: 'bg-critical',
}
