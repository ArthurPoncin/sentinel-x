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

// The Status in a word, when it is asked for.
const STATUS_NAMED: Record<StatusLevel, string> = { nominal: 'nominal', elevated: 'vigilance', critical: 'critique' }

// The sentences of the report, when the Operator asks for it: the Status and how many Alerts are active, then
// each of them, the most severe first. With none, that the site is nominal. Unlike an announcement, it says
// what is, not what changed: an Alert raised an hour ago is in it.
export function report({ alerts, status }: Watched): string[] {
  if (alerts.length === 0) {
    return [status === 'nominal' ? 'Site nominal : aucune alerte active.' : `Statut ${STATUS_NAMED[status]} : aucune alerte active.`]
  }
  const active = `${plural(alerts.length, 'alerte')} ${alerts.length > 1 ? 'actives' : 'active'}`
  return [`Statut ${STATUS_NAMED[status]} : ${active}.`, ...byUrgency(alerts).map(sayAlert)]
}
