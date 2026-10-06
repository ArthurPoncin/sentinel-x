import { describe, expect, it } from 'vitest'
import type { Incident } from '@/shared/contract'
import { clockTime, describeIncident, minutes } from './labels'

const INCIDENT: Incident = {
  incident_id: 3,
  start: '2026-10-06T14:23:00Z',
  end: '2026-10-06T14:23:50Z',
  ongoing: false,
  alerts: 8,
  kinds: ['gas', 'presence'],
  peak: 'critical',
}

describe('labels', () => {
  it('reads an instant to the second on a 24-hour clock', () => {
    expect(clockTime(Date.parse('2026-10-06T14:23:07Z'), 'UTC')).toBe('14:23:07')
  })

  it('reads seconds as m:ss', () => {
    expect(minutes(0)).toBe('0:00')
    expect(minutes(7)).toBe('0:07')
    expect(minutes(63)).toBe('1:03')
  })

  it('lists an Incident by number, day and time, length, kinds and peak', () => {
    expect(describeIncident(INCIDENT, 'UTC')).toBe('#3 · Tue 14:23:00 · 0:50 · gas, presence · critical')
  })

  it('says an Incident still going on is ongoing', () => {
    expect(describeIncident({ ...INCIDENT, end: null, ongoing: true }, 'UTC')).toBe(
      '#3 · Tue 14:23:00 · ongoing · gas, presence · critical',
    )
  })
})
