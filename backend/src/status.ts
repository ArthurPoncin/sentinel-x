import type { Severity, StatusLevel } from './contract.js'

// The Outpost Status is the highest severity among the active Alerts.
export function computeStatus(activeAlerts: readonly { severity: Severity }[]): StatusLevel {
  if (activeAlerts.some((alert) => alert.severity === 'critical')) return 'critical'
  if (activeAlerts.some((alert) => alert.severity === 'warning')) return 'elevated'
  return 'nominal'
}
