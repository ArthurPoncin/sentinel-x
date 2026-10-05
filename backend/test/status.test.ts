import { describe, expect, it } from 'vitest'
import { computeStatus } from '../src/status.js'

describe('computeStatus', () => {
  it('is nominal when no Alert is active', () => {
    expect(computeStatus([])).toBe('nominal')
  })

  it('is elevated when the worst active Alert is a warning', () => {
    expect(computeStatus([{ severity: 'info' }, { severity: 'warning' }])).toBe('elevated')
  })

  it('is critical as soon as one active Alert is critical', () => {
    const activeAlerts = [{ severity: 'warning' }, { severity: 'critical' }, { severity: 'info' }] as const

    expect(computeStatus(activeAlerts)).toBe('critical')
  })

  it('stays nominal when only info Alerts are active', () => {
    expect(computeStatus([{ severity: 'info' }])).toBe('nominal')
  })
})
