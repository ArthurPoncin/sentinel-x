import { describe, expect, it } from 'vitest'
import type { Incident } from '@/shared/contract'
import { latestFirst, summarize } from './summary'

const at = (second: number) => new Date(Date.UTC(2026, 9, 5, 14, 0, second)).toISOString()

function incident(id: number, overrides: Partial<Incident> = {}): Incident {
  return {
    incident_id: id,
    start: at(0),
    end: at(20),
    ongoing: false,
    alerts: 2,
    kinds: ['gas'],
    peak: 'warning',
    ...overrides,
  }
}

describe('summarize', () => {
  it('counts the Incidents, the resolved and the ongoing ones', () => {
    const summary = summarize([incident(1), incident(2), incident(3, { end: null, ongoing: true })])

    expect(summary).toMatchObject({ total: 3, resolved: 2, ongoing: 1 })
  })

  it('counts those that went critical', () => {
    const summary = summarize([incident(1, { peak: 'critical' }), incident(2)])

    expect(summary.critical).toBe(1)
  })

  it('averages the time back to nominal over the resolved Incidents only', () => {
    const summary = summarize([
      incident(1, { start: at(0), end: at(10) }),
      incident(2, { start: at(0), end: at(30) }),
      incident(3, { end: null, ongoing: true }),
    ])

    expect(summary.meanResolutionMs).toBe(20_000)
  })

  it('has no mean before an Incident is resolved', () => {
    expect(summarize([incident(1, { end: null, ongoing: true })]).meanResolutionMs).toBeNull()
    expect(summarize([]).meanResolutionMs).toBeNull()
  })

  it('counts the Incidents each kind took part in, the most frequent first', () => {
    const summary = summarize([
      incident(1, { kinds: ['predictive', 'gas', 'thermal'] }),
      incident(2, { kinds: ['intrusion'] }),
      incident(3, { kinds: ['gas'] }),
    ])

    expect(summary.byKind[0]).toEqual({ kind: 'gas', incidents: 2 })
    expect(summary.byKind).toHaveLength(4)
  })
})

describe('latestFirst', () => {
  it('lists the latest Incidents first, up to the limit', () => {
    expect(latestFirst([incident(1), incident(2), incident(3)], 2).map((i) => i.incident_id)).toEqual([3, 2])
  })
})
