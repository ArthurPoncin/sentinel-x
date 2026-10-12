import type { Alert, Severity, StatusLevel } from '@/shared/contract'
import { decimal } from '@/shared/lib/format'
import { KIND_LABEL, plural, VECTOR_LABEL } from '@/shared/lib/labels'
import { byUrgency, newlyRaised } from './describe'

// What the Outpost is going through at one moment, as the feed gives it.
export interface Watched {
  alerts: readonly Alert[]
  status: StatusLevel
}

// How grave, said before anything else: the first words are the ones heard for sure.
const SEVERITY_SAID: Record<Severity, string> = {
  critical: 'Alerte critique',
  warning: 'Avertissement',
  info: 'Information',
}

// The Status in a sentence, when the Command Post changes it. Nominal is always a way back.
const STATUS_SAID: Record<StatusLevel, string> = {
  nominal: 'Retour au statut nominal : aucune menace en cours.',
  elevated: 'Statut vigilance : un avertissement à surveiller.',
  critical: 'Statut critique : intervention requise.',
}

// What an Alert measures, for the ear: no sign, no unit a voice would spell, no address read digit by digit,
// and none of the model's own names for what drifts.
function measured(alert: Alert): string {
  switch (alert.kind) {
    case 'intrusion':
      return `une personne détectée, confiance ${Math.round(alert.detail.confidence * 100)} pour cent`
    case 'predictive':
      return `score d'anomalie ${decimal(alert.detail.anomaly_score, 2)}`
    case 'gas':
      return alert.value === undefined ? 'mesure hors seuil' : `mesure à ${alert.value}`
    case 'thermal':
      return alert.value === undefined ? 'température hors seuil' : `température à ${decimal(alert.value, 1)} degrés`
    case 'noise':
      return alert.value === undefined ? 'niveau sonore élevé' : `du son sur ${Math.round(alert.value * 100)} pour cent du cycle`
    case 'presence':
      return 'mouvement détecté par le capteur infrarouge'
    case 'cyber': {
      const { attempts, vector } = alert.detail
      return `${plural(attempts, 'tentative')} ${attempts > 1 ? 'refusées' : 'refusée'} sur ${VECTOR_LABEL[vector]}`
    }
  }
}

// The sentence that says an Alert: how grave, its kind, what it measures.
export function sayAlert(alert: Alert): string {
  return `${SEVERITY_SAID[alert.severity]}. ${KIND_LABEL[alert.kind]} : ${measured(alert)}.`
}

// The sentences to say for what changed between two moments, in the order to say them: the Alerts the toasts
// would show (raised, or escalated, once per alert_id), the most severe first, then the Status if it changed.
export function announcements(before: Watched, after: Watched): string[] {
  const said = byUrgency(newlyRaised(before.alerts, after.alerts)).map(sayAlert)
  return before.status === after.status ? said : [...said, STATUS_SAID[after.status]]
}
