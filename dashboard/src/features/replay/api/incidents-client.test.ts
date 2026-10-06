import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Incident, IncidentReplay } from '@/shared/contract'
import { fetchIncidentReplay, fetchIncidents } from './incidents-client'

const INCIDENT: Incident = {
  incident_id: 1,
  start: '2026-10-05T14:23:00Z',
  end: '2026-10-05T14:23:50Z',
  ongoing: false,
  alerts: 2,
  kinds: ['gas'],
  peak: 'warning',
}

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Incidents client', () => {
  it('lists the Incidents of the Command Post, from the app’s own origin', async () => {
    const fetch = answer(200, { incidents: [INCIDENT] })

    expect(await fetchIncidents()).toEqual([INCIDENT])
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/incidents')
  })

  it('fetches what is replayed of an Incident', async () => {
    const replay: IncidentReplay = { incident: INCIDENT, records: [] }
    const fetch = answer(200, replay)

    expect(await fetchIncidentReplay(1)).toEqual(replay)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/incidents/1')
  })

  it('fails on anything but a 200, a refused session included', async () => {
    answer(401, { error: 'Unauthorized' })
    await expect(fetchIncidents()).rejects.toThrow('GET /api/v1/incidents: 401')
  })

  it('fails on a body outside the contract', async () => {
    answer(200, { incidents: [{ ...INCIDENT, peak: 'severe' }] })
    await expect(fetchIncidents()).rejects.toThrow()
  })
})
