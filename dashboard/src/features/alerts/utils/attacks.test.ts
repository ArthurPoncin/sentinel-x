import { describe, expect, it } from 'vitest'
import type { Alert, CyberVector, Frame } from '@/shared/contract'
import { attacks } from './attacks'

const at = (second: number) => Date.UTC(2026, 9, 5, 14, 0, second)

// A brute force the API refuses, `attempts` refusals in, one a second.
function attack(
  attempts: number,
  { vector = 'login', id = 'cyber-login-1', state = 'raised', address }: { vector?: CyberVector; id?: string; state?: 'raised' | 'cleared'; address?: string } = {},
): Alert {
  return {
    alert_id: id,
    sentinel: 'command-post',
    source: 'api',
    kind: 'cyber',
    severity: 'warning',
    state,
    value: attempts,
    detail: address === undefined ? { vector, attempts } : { vector, attempts, address },
    ts: new Date(at(attempts)).toISOString(),
  }
}

const gas: Alert = {
  alert_id: 'gas-1',
  sentinel: 'sentinel-01',
  source: 'esp32',
  kind: 'gas',
  severity: 'critical',
  state: 'raised',
  value: 420,
  detail: {},
  ts: new Date(at(2)).toISOString(),
}

const frames = (...alerts: Alert[]): Frame[] => alerts.map((alert) => ({ type: 'alert', payload: alert }))

describe('attacks', () => {
  it('gives none when no cyber Alert is active', () => {
    expect(attacks([], [])).toEqual([])
    expect(attacks([gas], frames(gas))).toEqual([])
  })

  it('gives an attack its entry point, where it comes from, the attempts refused and since when', () => {
    const raised = attack(5, { address: '192.168.4.66' })

    expect(attacks([raised], frames(raised))).toEqual([
      { alertId: 'cyber-login-1', vector: 'login', address: '192.168.4.66', attempts: 5, since: at(5) },
    ])
  })

  it('leaves out where it comes from when the Command Post does not know', () => {
    const raised = attack(5)

    expect(attacks([raised], frames(raised))[0]).not.toHaveProperty('address')
  })

  it('follows the count as the Alert is raised again, since the first time it was', () => {
    const raises = [attack(5), attack(6), attack(7), attack(14)]

    expect(attacks([attack(14)], frames(...raises))).toEqual([
      { alertId: 'cyber-login-1', vector: 'login', attempts: 14, since: at(5) },
    ])
  })

  it('gives each entry point attacked its own, in the order they began', () => {
    const token = { vector: 'service-token', id: 'cyber-service-token-1' } as const
    const history = frames(attack(5), attack(6, token), attack(7), attack(8, token))

    expect(attacks([attack(7), attack(8, token)], history)).toEqual([
      { alertId: 'cyber-login-1', vector: 'login', attempts: 7, since: at(5) },
      { alertId: 'cyber-service-token-1', vector: 'service-token', attempts: 8, since: at(6) },
    ])
  })

  it('counts an attack that starts again under the same alert_id from its new start', () => {
    const history = frames(attack(5), attack(9), attack(9, { state: 'cleared' }), attack(30), attack(31))

    expect(attacks([attack(31)], history)[0]?.since).toBe(at(30))
  })

  it('takes the Alert it holds for the start when the frames no longer have the first raise', () => {
    expect(attacks([attack(40)], [])[0]?.since).toBe(at(40))
  })
})
