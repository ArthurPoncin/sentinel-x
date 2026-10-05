import type { Severity, StatusLevel } from '@/shared/contract'

// One color per level, kept to a dot or a figure: green, amber, red.
export type Tone = 'nominal' | 'elevated' | 'critical'

export const toneOfStatus: Record<StatusLevel, Tone> = { nominal: 'nominal', elevated: 'elevated', critical: 'critical' }
export const toneOfSeverity: Record<Severity, Tone> = { info: 'nominal', warning: 'elevated', critical: 'critical' }

// Full class names, so Tailwind finds them in the source.
export const toneText: Record<Tone, string> = {
  nominal: 'text-nominal',
  elevated: 'text-elevated',
  critical: 'text-critical',
}

export const toneDot: Record<Tone, string> = {
  nominal: 'bg-nominal',
  elevated: 'bg-elevated',
  critical: 'bg-critical',
}
