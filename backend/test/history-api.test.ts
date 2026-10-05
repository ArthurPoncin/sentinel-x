import { describe, expect, it, vi } from 'vitest'
import { type HistoryRecord, HistorySchema, type Telemetry } from '../src/contract.js'
import { createMemoryHistory } from '../src/history.js'
import { intrusionAlert, predictiveAlert } from './support/alerts.js'
import { startBroker } from './support/broker.js'
import { startServer } from './support/server.js'

vi.spyOn(console, 'log').mockImplementation(() => {})

function snapshot(ts: string, air = 180): Telemetry {
  return { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.02 } }
}

function telemetry(ts: string, air?: number): HistoryRecord {
  return { type: 'telemetry', payload: snapshot(ts, air) }
}

const WHOLE_DAY = { from: '2026-10-05T00:00:00Z', to: '2026-10-05T23:59:59Z' }

describe('GET /api/v1/history', () => {
  it('answers the records of the range, sorted by date', async () => {
    const history = createMemoryHistory()
    history.append(telemetry('2026-10-05T14:23:10Z', 450))
    history.append({ type: 'alert', payload: intrusionAlert({ ts: '2026-10-05T14:23:05Z' }) })
    history.append(telemetry('2026-10-05T14:23:00Z', 420))
    history.append(telemetry('2026-10-05T14:30:00Z', 700))
    const { getHistory } = await startServer({ history })

    const response = await getHistory({ from: '2026-10-05T14:23:00Z', to: '2026-10-05T14:25:00Z' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      records: [
        telemetry('2026-10-05T14:23:00Z', 420),
        { type: 'alert', payload: intrusionAlert({ ts: '2026-10-05T14:23:05Z' }) },
        telemetry('2026-10-05T14:23:10Z', 450),
      ],
    })
  })

  it('answers an empty list, not an error, for a range where nothing happened', async () => {
    const history = createMemoryHistory()
    history.append(telemetry('2026-10-05T14:23:00Z'))
    const { getHistory } = await startServer({ history })

    const response = await getHistory({ from: '2026-10-06T00:00:00Z', to: '2026-10-06T01:00:00Z' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ records: [] })
  })

  it('takes a range of a single instant', async () => {
    const history = createMemoryHistory()
    history.append(telemetry('2026-10-05T14:23:00Z'))
    const { getHistory } = await startServer({ history })

    const response = await getHistory({ from: '2026-10-05T14:23:00Z', to: '2026-10-05T14:23:00Z' })

    expect(await response.json()).toEqual({ records: [telemetry('2026-10-05T14:23:00Z')] })
  })

  describe('answers 400 and names the offending bound', () => {
    it.each([
      ['without `from`', { to: WHOLE_DAY.to }, 'from'],
      ['without `to`', { from: WHOLE_DAY.from }, 'to'],
      ['with a bound that is not ISO 8601', { ...WHOLE_DAY, from: '05/10/2026 14:23' }, 'from'],
      ['with `from` after `to`', { from: WHOLE_DAY.to, to: WHOLE_DAY.from }, 'to'],
    ])('%s', async (_label, query, bound) => {
      const { getHistory } = await startServer()

      const response = await getHistory(query)

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ statusCode: 400, message: expect.stringContaining(bound) })
    })
  })
})

describe('what comes in goes into the history', () => {
  it('records the Alerts the AI services post', async () => {
    const { postAlert, getHistory } = await startServer()

    await postAlert(intrusionAlert())
    await postAlert(predictiveAlert({ ts: '2026-10-05T14:23:06Z' }))
    await postAlert(intrusionAlert({ state: 'cleared', ts: '2026-10-05T14:23:07Z' }))

    const history = HistorySchema.parse(await (await getHistory(WHOLE_DAY)).json())
    expect(history.records).toEqual([
      { type: 'alert', payload: intrusionAlert() },
      { type: 'alert', payload: predictiveAlert({ ts: '2026-10-05T14:23:06Z' }) },
      { type: 'alert', payload: intrusionAlert({ state: 'cleared', ts: '2026-10-05T14:23:07Z' }) },
    ])
  })

  it('records nothing of an Alert it refuses', async () => {
    const { postAlert, getHistory } = await startServer()

    await postAlert({ ...intrusionAlert(), kind: 'gas' })
    await postAlert({ ...intrusionAlert(), firmware: '1.0.0' })

    expect(await (await getHistory(WHOLE_DAY)).json()).toEqual({ records: [] })
  })

  it('records the telemetry the Sentinels publish over MQTTS', async () => {
    const broker = await startBroker()
    const { getHistory } = await startServer({ mqtt: broker.config })
    await broker.subscribed()

    await broker.publish('sentinel/sentinel-01/telemetry', JSON.stringify(snapshot('2026-10-05T14:23:00Z', 420)))
    await broker.publish('sentinel/sentinel-01/telemetry', JSON.stringify({ ts: 'garbage' }))
    await broker.publish('sentinel/sentinel-01/telemetry', JSON.stringify(snapshot('2026-10-05T14:23:02Z', 450)))

    await vi.waitFor(async () => {
      expect(await (await getHistory(WHOLE_DAY)).json()).toEqual({
        records: [telemetry('2026-10-05T14:23:00Z', 420), telemetry('2026-10-05T14:23:02Z', 450)],
      })
    })
  })
})
