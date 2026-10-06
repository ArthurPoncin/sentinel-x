import type { AlertKind, AlertSource, Severity, StatusLevel } from '@/shared/contract'

// What the Operator reads for each contract value, the same on every panel. The UI is in French:
// the Operator and the jury are.
export const KIND_LABEL: Record<AlertKind, string> = {
  gas: 'Fuite de gaz',
  thermal: 'Surchauffe',
  presence: 'Présence',
  noise: 'Bruit',
  intrusion: 'Intrusion',
  predictive: 'Dérive prédite',
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Info',
  warning: 'Avertissement',
  critical: 'Critique',
}

export const SOURCE_LABEL: Record<AlertSource, string> = {
  esp32: 'Sentinel',
  vision: 'IA vision',
  predictive: 'IA prédictive',
}

export const STATUS_LABEL: Record<StatusLevel, string> = {
  nominal: 'Nominal',
  elevated: 'Vigilance',
  critical: 'Critique',
}

// "1 alerte", "3 alertes".
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}
