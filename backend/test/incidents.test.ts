import { describe, expect, it, vi } from 'vitest'
import { type Alert, type HistoryRecord, type Incident, IncidentReplaySchema, IncidentsSchema } from '../src/contract.js'
import { createMemoryHistory } from '../src/history.js'
import { gasAlert, intrusionAlert, presenceAlert } from './support/alerts.js'
import { startServer } from './support/server.js'

vi.spyOn(console, 'log').mockImplementation(() => {})

const at = (time: string) => `2026-10-05T${time}Z`

function telemetry(time: string, air = 180): HistoryRecord {
  return {
    type: 'telemetry',
    payload: {
      sentinel: 'sentinel-01',
      ts: at(time),
      readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 1350 },
    },
  }
}

function alert(payload: Alert): HistoryRecord {
  return { type: 'alert', payload }
}

// The reference scenario: the gas goes nominal → warning → critical → warning → nominal, and the PIR
// detects someone twice meanwhile. 8 Alerts, 1 Incident.
const REFERENCE: HistoryRecord[] = [
  telemetry('14:22:50'),
  telemetry('14:22:55'),
  alert(gasAlert({ alert_id: 'gas-1', severity: 'warning', value: 420, ts: at('14:23:00') })),
  telemetry('14:23:00', 420),
  alert(presenceAlert({ alert_id: 'pir-1', ts: at('14:23:10') })),
  alert(presenceAlert({ alert_id: 'pir-1', state: 'cleared', ts: at('14:23:12') })),
  alert(gasAlert({ alert_id: 'gas-1', severity: 'critical', value: 650, ts: at('14:23:20') })),
  telemetry('14:23:20', 650),
  alert(presenceAlert({ alert_id: 'pir-2', ts: at('14:23:30') })),
  alert(presenceAlert({ alert_id: 'pir-2', state: 'cleared', ts: at('14:23:33') })),
  alert(gasAlert({ alert_id: 'gas-1', severity: 'warning', value: 430, ts: at('14:23:40') })),
  telemetry('14:23:40', 430),
  alert(gasAlert({ alert_id: 'gas-1', state: 'cleared', ts: at('14:23:50') })),
  telemetry('14:23:50', 190),
  telemetry('14:24:00'),
]

const REFERENCE_INCIDENT: Incident = {
  incident_id: 1,
  start: at('14:23:00'),
  end: at('14:23:50'),
  ongoing: false,
  alerts: 8,
  kinds: ['gas', 'presence'],
  peak: 'critical',
}

async function serverWith(records: HistoryRecord[]) {
  const history = createMemoryHistory()
  for (const record of records) history.append(record)
  return startServer({ history })
}

async function incidentsOf(records: HistoryRecord[]): Promise<Incident[]> {
  const { getIncidents } = await serverWith(records)
  const response = await getIncidents()
  expect(response.status).toBe(200)
  return IncidentsSchema.parse(await response.json()).incidents
}

describe('GET /api/v1/incidents', () => {
  it('makes one Incident of the reference scenario, with its 8 Alerts', async () => {
    expect(await incidentsOf(REFERENCE)).toEqual([REFERENCE_INCIDENT])
  })

  it('answers an empty list when nothing was ever raised', async () => {
    expect(await incidentsOf([telemetry('14:23:00')])).toEqual([])
  })

  it('opens a new Incident on the first raised after a return to nominal', async () => {
    const incidents = await incidentsOf([
      alert(gasAlert({ ts: at('14:23:00') })),
      alert(gasAlert({ state: 'cleared', ts: at('14:24:00') })),
      alert(intrusionAlert({ ts: at('14:30:00') })),
      alert(intrusionAlert({ state: 'cleared', ts: at('14:31:00') })),
    ])

    expect(incidents).toMatchObject([
      { incident_id: 1, start: at('14:23:00'), end: at('14:24:00'), kinds: ['gas'], peak: 'warning' },
      { incident_id: 2, start: at('14:30:00'), end: at('14:31:00'), kinds: ['intrusion'], peak: 'critical' },
    ])
  })

  it('lasts until every Alert is cleared, whichever Alert opened it', async () => {
    const incidents = await incidentsOf([
      alert(gasAlert({ ts: at('14:23:00') })),
      alert(intrusionAlert({ ts: at('14:23:10') })),
      alert(gasAlert({ state: 'cleared', ts: at('14:23:20') })),
      alert(intrusionAlert({ state: 'cleared', ts: at('14:23:30') })),
    ])

    expect(incidents).toMatchObject([{ start: at('14:23:00'), end: at('14:23:30'), alerts: 4 }])
  })

  it('needs one cleared for an Alert raised again on the same alert_id', async () => {
    const incidents = await incidentsOf([
      alert(gasAlert({ severity: 'warning', ts: at('14:23:00') })),
      alert(gasAlert({ severity: 'critical', ts: at('14:23:10') })),
      alert(gasAlert({ state: 'cleared', ts: at('14:23:20') })),
    ])

    expect(incidents).toMatchObject([{ end: at('14:23:20'), ongoing: false, alerts: 3 }])
  })

  it('says an Incident is going on until every Alert is cleared', async () => {
    const incidents = await incidentsOf([
      alert(gasAlert({ ts: at('14:23:00') })),
      alert(presenceAlert({ ts: at('14:23:10') })),
      alert(presenceAlert({ state: 'cleared', ts: at('14:23:12') })),
    ])

    expect(incidents).toEqual([
      {
        incident_id: 1,
        start: at('14:23:00'),
        end: null,
        ongoing: true,
        alerts: 3,
        kinds: ['gas', 'presence'],
        peak: 'warning',
      },
    ])
  })

  it('opens nothing on a cleared with no Incident going on', async () => {
    const incidents = await incidentsOf([
      alert(gasAlert({ state: 'cleared', ts: at('14:22:00') })),
      alert(gasAlert({ ts: at('14:23:00') })),
      alert(gasAlert({ state: 'cleared', ts: at('14:24:00') })),
      alert(gasAlert({ state: 'cleared', ts: at('14:25:00') })),
    ])

    expect(incidents).toMatchObject([{ start: at('14:23:00'), end: at('14:24:00'), alerts: 2 }])
  })

  it('groups the Alerts by date, whatever order they came in', async () => {
    const incidents = await incidentsOf([
      alert(gasAlert({ state: 'cleared', ts: at('14:24:00') })),
      alert(gasAlert({ ts: at('14:23:00') })),
    ])

    expect(incidents).toMatchObject([{ start: at('14:23:00'), end: at('14:24:00'), ongoing: false }])
  })

  it('counts the Alerts the AI services post', async () => {
    const { postAlert, getIncidents } = await startServer()

    await postAlert(intrusionAlert({ ts: at('14:23:00') }))
    await postAlert(intrusionAlert({ state: 'cleared', ts: at('14:23:30') }))

    expect(IncidentsSchema.parse(await (await getIncidents()).json()).incidents).toMatchObject([
      { start: at('14:23:00'), end: at('14:23:30'), kinds: ['intrusion'] },
    ])
  })
})

describe('GET /api/v1/incidents/:incident_id', () => {
  it('answers the Incident and its telemetry and Alerts, oldest first', async () => {
    const { getIncident } = await serverWith(REFERENCE)

    const response = await getIncident(1)

    expect(response.status).toBe(200)
    expect(IncidentReplaySchema.parse(await response.json())).toEqual({
      incident: REFERENCE_INCIDENT,
      // From the Alert that opened it to the one that closed it, both included.
      records: REFERENCE.slice(2, 14),
    })
  })

  it('gives back an Incident that is going on up to its latest record', async () => {
    const records = [
      telemetry('14:22:55'),
      alert(gasAlert({ ts: at('14:23:00') })),
      telemetry('14:23:00', 420),
      telemetry('14:23:05', 450),
    ]
    const { getIncident } = await serverWith(records)

    const replay = IncidentReplaySchema.parse(await (await getIncident(1)).json())

    expect(replay).toEqual({
      incident: expect.objectContaining({ end: null, ongoing: true }),
      records: records.slice(1),
    })
  })

  it('leaves out the Alerts of the Incidents sharing its first and last instants', async () => {
    const previousEnds = alert(presenceAlert({ state: 'cleared', ts: at('14:23:00') }))
    const opens = alert(gasAlert({ ts: at('14:23:00') }))
    const closes = alert(gasAlert({ state: 'cleared', ts: at('14:24:00') }))
    const nextOpens = alert(presenceAlert({ ts: at('14:24:00') }))
    const { getIncident } = await serverWith([
      alert(presenceAlert({ ts: at('14:22:00') })),
      previousEnds,
      opens,
      telemetry('14:23:00'),
      closes,
      nextOpens,
      telemetry('14:24:00'),
    ])

    const replay = IncidentReplaySchema.parse(await (await getIncident(2)).json())

    expect(replay.incident).toMatchObject({ start: at('14:23:00'), end: at('14:24:00'), alerts: 2 })
    expect(replay.records).toEqual([opens, telemetry('14:23:00'), closes, telemetry('14:24:00')])
  })

  it('answers 404 for an Incident that does not exist', async () => {
    const { getIncident } = await serverWith(REFERENCE)

    const response = await getIncident(2)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ statusCode: 404, message: 'No Incident 2' })
  })

  it.each(['0', '-1', '1.5', 'latest'])('answers 400 for the id %s', async (id) => {
    const { getIncident } = await serverWith(REFERENCE)

    const response = await getIncident(id)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ statusCode: 400, message: expect.stringContaining('incident_id') })
  })
})
