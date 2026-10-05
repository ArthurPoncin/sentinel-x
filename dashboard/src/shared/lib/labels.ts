import type { AlertKind, Severity } from '@/shared/contract'

// The words the Operator reads for each contract value, the same on every panel.
export const KIND_LABEL: Record<AlertKind, string> = {
  gas: 'Gas leak',
  thermal: 'Overheating',
  presence: 'Presence',
  noise: 'Noise',
  intrusion: 'Intrusion',
  predictive: 'Predicted drift',
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}
