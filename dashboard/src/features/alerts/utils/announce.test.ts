import { describe, expect, it } from 'vitest'
import type { Alert, AlertKind, Severity, StatusLevel } from '@/shared/contract'
import { announcements, report, sayAlert } from './announce'

const at = (second: number) => new Date(Date.UTC(2026, 9, 12, 14, 0, second)).toISOString()

function gas(id: string, severity: Severity, second = 0): Alert {
  return { alert_id: id, sentinel: 'sentinel-01', source: 'esp32', kind: 'gas', severity, state: 'raised', value: 420, detail: {}, ts: at(second) }
}

function intruder(x_norm: number): Alert {
  return {
    alert_id: 'intruder',
    sentinel: 'sentinel-01',
    source: 'vision',
    kind: 'intrusion',
    severity: 'critical',
    state: 'raised',
    detail: { x_norm, confidence: 0.88, bbox: [120, 80, 60, 180] },
    ts: at(0),
  }
}

// A brute force the API refuses, `attempts` refusals in.
function attack(attempts: number): Alert {
  return {
    alert_id: 'cyber-login-1',
    sentinel: 'command-post',
    source: 'api',
    kind: 'cyber',
    severity: 'warning',
    state: 'raised',
    value: attempts,
    detail: { vector: 'login', attempts, address: '192.168.4.66' },
    ts: at(attempts),
  }
}

const watched = (alerts: readonly Alert[], status: StatusLevel = 'nominal') => ({ alerts, status })

describe('announcements', () => {
  it('says the kind of an Alert raised and what it measures', () => {
    expect(announcements(watched([]), watched([gas('a', 'warning')]))).toEqual(['Avertissement. Fuite de gaz : mesure à 420.'])
  })

  it('says nothing when nothing changed', () => {
    expect(announcements(watched([gas('a', 'warning')], 'elevated'), watched([gas('a', 'warning')], 'elevated'))).toEqual([])
  })

  it('says nothing more of an Alert raised again as it was: an intruder that moves, an attack that goes on', () => {
    expect(announcements(watched([intruder(0.15)]), watched([intruder(0.35)]))).toEqual([])
    expect(announcements(watched([attack(5)]), watched([attack(6)]))).toEqual([])
  })

  it('says an Alert again when it escalates, not when it eases or clears', () => {
    expect(announcements(watched([gas('a', 'warning')]), watched([gas('a', 'critical')]))).toEqual([
      'Alerte critique. Fuite de gaz : mesure à 420.',
    ])
    expect(announcements(watched([gas('a', 'critical')]), watched([gas('a', 'warning')]))).toEqual([])
    expect(announcements(watched([gas('a', 'critical')]), watched([]))).toEqual([])
  })

  it('says the most severe first of two Alerts raised at once', () => {
    const said = announcements(watched([]), watched([gas('a', 'warning'), intruder(0.4)]))

    expect(said).toEqual([
      'Alerte critique. Intrusion : une personne détectée, confiance 88 pour cent.',
      'Avertissement. Fuite de gaz : mesure à 420.',
    ])
  })

  it('says a change of Status, on the way up and back to nominal', () => {
    expect(announcements(watched([]), watched([], 'elevated'))).toEqual(['Statut vigilance : un avertissement à surveiller.'])
    expect(announcements(watched([], 'elevated'), watched([], 'critical'))).toEqual(['Statut critique : intervention requise.'])
    expect(announcements(watched([], 'critical'), watched([]))).toEqual(['Retour au statut nominal : aucune menace en cours.'])
  })

  it('says the Alerts before the Status they changed', () => {
    expect(announcements(watched([]), watched([gas('a', 'warning')], 'elevated'))).toEqual([
      'Avertissement. Fuite de gaz : mesure à 420.',
      'Statut vigilance : un avertissement à surveiller.',
    ])
  })
})

describe('sayAlert', () => {
  const base = { alert_id: 'a', sentinel: 'sentinel-01', severity: 'warning', state: 'raised', ts: at(0) } as const
  const OF_KIND: Record<AlertKind, Alert> = {
    gas: gas('a', 'warning'),
    thermal: { ...base, source: 'esp32', kind: 'thermal', value: 33.5, detail: {} },
    presence: { ...base, source: 'esp32', kind: 'presence', severity: 'info', detail: {} },
    noise: { ...base, source: 'esp32', kind: 'noise', value: 0.4, detail: {} },
    intrusion: intruder(0.4),
    predictive: { ...base, source: 'predictive', kind: 'predictive', detail: { anomaly_score: 0.91, drivers: ['temp_slope'] } },
    cyber: attack(14),
  }

  it('has a sentence for each kind of Alert, cyber too', () => {
    expect(Object.fromEntries(Object.entries(OF_KIND).map(([kind, alert]) => [kind, sayAlert(alert)]))).toEqual({
      gas: 'Avertissement. Fuite de gaz : mesure à 420.',
      thermal: 'Avertissement. Surchauffe : température à 33,5 degrés.',
      presence: 'Information. Présence : mouvement détecté par le capteur infrarouge.',
      noise: 'Avertissement. Bruit : du son sur 40 pour cent du cycle.',
      intrusion: 'Alerte critique. Intrusion : une personne détectée, confiance 88 pour cent.',
      predictive: "Avertissement. Dérive prédite : score d'anomalie 0,91.",
      cyber: 'Avertissement. Cyberattaque : 14 tentatives refusées sur le login.',
    })
  })

  it('says a measure out of bounds when the Alert carries no value', () => {
    expect(sayAlert({ ...base, source: 'esp32', kind: 'gas', detail: {} })).toBe('Avertissement. Fuite de gaz : mesure hors seuil.')
    expect(sayAlert({ ...base, source: 'esp32', kind: 'thermal', detail: {} })).toBe('Avertissement. Surchauffe : température hors seuil.')
    expect(sayAlert({ ...base, source: 'esp32', kind: 'noise', detail: {} })).toBe('Avertissement. Bruit : niveau sonore élevé.')
  })

  it('says one attempt in the singular', () => {
    expect(sayAlert(attack(1))).toBe('Avertissement. Cyberattaque : 1 tentative refusée sur le login.')
  })
})

describe('report', () => {
  it('says the site is nominal when no Alert is active', () => {
    expect(report(watched([]))).toEqual(['Site nominal : aucune alerte active.'])
  })

  it('says the Status and how many Alerts are active, then each of them', () => {
    expect(report(watched([gas('a', 'warning')], 'elevated'))).toEqual([
      'Statut vigilance : 1 alerte active.',
      'Avertissement. Fuite de gaz : mesure à 420.',
    ])
  })

  it('says the most severe Alert first, then the latest', () => {
    const said = report(watched([gas('a', 'warning', 1), gas('b', 'warning', 5), intruder(0.4)], 'critical'))

    expect(said).toEqual([
      'Statut critique : 3 alertes actives.',
      'Alerte critique. Intrusion : une personne détectée, confiance 88 pour cent.',
      sayAlert(gas('b', 'warning', 5)),
      sayAlert(gas('a', 'warning', 1)),
    ])
  })

  it('says every active Alert, an old one as well: nothing of a report is news', () => {
    const alerts = Array.from({ length: 6 }, (_, index) => gas(`g-${index}`, 'warning', index))

    expect(report(watched(alerts, 'elevated'))).toHaveLength(1 + alerts.length)
  })

  it('says the Status as it is when it and the Alerts do not agree yet', () => {
    expect(report(watched([], 'elevated'))).toEqual(['Statut vigilance : aucune alerte active.'])
    expect(report(watched([gas('a', 'warning')]))).toEqual(['Statut nominal : 1 alerte active.', sayAlert(gas('a', 'warning'))])
  })
})
