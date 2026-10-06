import { describe, expect, it } from 'vitest'
import type { Alert, Severity } from '@/shared/contract'
import { filterLog, inHours, isFiltering, NO_FILTER, toggle } from './log-filter'

// On the local wall clock, as the Operator reads it.
const local = (hours: number, minutes: number, seconds = 0) => new Date(2026, 9, 5, hours, minutes, seconds).toISOString()

function gas(id: string, severity: Severity, ts: string, state: 'raised' | 'cleared' = 'raised'): Alert {
  return { alert_id: id, sentinel: 'sentinel-01', source: 'esp32', kind: 'gas', severity, state, value: 420, detail: {}, ts }
}

const presence: Alert = {
  alert_id: 'pir',
  sentinel: 'sentinel-01',
  source: 'esp32',
  kind: 'presence',
  severity: 'info',
  state: 'raised',
  detail: {},
  ts: local(14, 10),
}

const intrusion: Alert = {
  alert_id: 'intruder',
  sentinel: 'sentinel-01',
  source: 'vision',
  kind: 'intrusion',
  severity: 'critical',
  state: 'raised',
  detail: { x_norm: 0.4, confidence: 0.88, bbox: [120, 80, 60, 180] },
  ts: local(14, 20),
}

const log = [gas('g1', 'warning', local(14, 0)), gas('g1', 'warning', local(14, 30), 'cleared'), presence, intrusion]

describe('inHours', () => {
  it('lets everything through without bounds', () => {
    expect(inHours(local(3, 0), '', '')).toBe(true)
  })

  it('includes both ends, to the minute', () => {
    expect(inHours(local(14, 5, 59), '14:00', '14:05')).toBe(true)
    expect(inHours(local(14, 0), '14:00', '14:05')).toBe(true)
    expect(inHours(local(14, 6), '14:00', '14:05')).toBe(false)
    expect(inHours(local(13, 59, 59), '14:00', '14:05')).toBe(false)
  })

  it('takes one bound alone', () => {
    expect(inHours(local(14, 0), '14:00', '')).toBe(true)
    expect(inHours(local(13, 0), '14:00', '')).toBe(false)
    expect(inHours(local(13, 0), '', '14:00')).toBe(true)
  })

  it('runs over midnight when the start comes after the end', () => {
    expect(inHours(local(23, 30), '22:00', '02:00')).toBe(true)
    expect(inHours(local(1, 0), '22:00', '02:00')).toBe(true)
    expect(inHours(local(12, 0), '22:00', '02:00')).toBe(false)
  })
})

describe('filterLog', () => {
  it('keeps the whole log without a filter', () => {
    expect(filterLog(log, NO_FILTER)).toEqual(log)
  })

  it('narrows to the chosen severities', () => {
    expect(filterLog(log, { ...NO_FILTER, severities: ['critical', 'info'] })).toEqual([presence, intrusion])
  })

  it('narrows to a time range', () => {
    expect(filterLog(log, { ...NO_FILTER, from: '14:05', to: '14:25' })).toEqual([presence, intrusion])
  })

  it('narrows to a kind, a source and a state', () => {
    expect(filterLog(log, { ...NO_FILTER, kind: 'gas' }).map((alert) => alert.state)).toEqual(['raised', 'cleared'])
    expect(filterLog(log, { ...NO_FILTER, source: 'vision' })).toEqual([intrusion])
    expect(filterLog(log, { ...NO_FILTER, state: 'cleared' })).toEqual([log[1]])
  })

  it('combines every filter', () => {
    expect(filterLog(log, { ...NO_FILTER, kind: 'gas', state: 'raised', from: '14:00', to: '14:00' })).toEqual([log[0]])
    expect(filterLog(log, { ...NO_FILTER, kind: 'gas', severities: ['critical'] })).toEqual([])
  })
})

describe('isFiltering', () => {
  it('tells whether any filter is set', () => {
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(isFiltering({ ...NO_FILTER, to: '14:00' })).toBe(true)
    expect(isFiltering({ ...NO_FILTER, severities: ['info'] })).toBe(true)
    expect(isFiltering({ ...NO_FILTER, source: 'vision' })).toBe(true)
  })
})

describe('toggle', () => {
  it('adds a value, then takes it away', () => {
    expect(toggle(['info'], 'critical')).toEqual(['info', 'critical'])
    expect(toggle(['info', 'critical'], 'info')).toEqual(['critical'])
  })
})
