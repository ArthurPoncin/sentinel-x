import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { HistoryRecord } from '../src/contract.js'
import { createMemoryHistory, type HistoryRepository, openSqliteHistory } from '../src/history.js'
import { gasAlert, intrusionAlert } from './support/alerts.js'

function telemetry(ts: string, air = 180): HistoryRecord {
  return {
    type: 'telemetry',
    payload: { sentinel: 'sentinel-01', ts, readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 0.02 } },
  }
}

function alert(ts: string): HistoryRecord {
  return { type: 'alert', payload: gasAlert({ ts }) }
}

// A directory of its own for the calling test, removed when it ends.
async function scratchDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sentinel-x-history-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function sqliteHistory(): Promise<HistoryRepository> {
  const history = openSqliteHistory(join(await scratchDirectory(), 'history.sqlite'))
  onTestFinished(() => history.close())
  return history
}

const WHOLE_DAY = { from: '2026-10-05T00:00:00Z', to: '2026-10-05T23:59:59Z' }

// Every implementation behind the repository interface passes the same suite.
describe.each([
  ['in memory', async () => createMemoryHistory()],
  ['SQLite', sqliteHistory],
])('history %s', (_label, open: () => Promise<HistoryRepository>) => {
  it('gives back nothing before anything was appended', async () => {
    const history = await open()

    expect(history.query(WHOLE_DAY)).toEqual([])
  })

  it('gives back telemetry and Alerts as they were appended', async () => {
    const history = await open()
    const records = [telemetry('2026-10-05T14:23:00Z'), { type: 'alert', payload: intrusionAlert() } as const]

    for (const record of records) history.append(record)

    expect(history.query(WHOLE_DAY)).toEqual(records)
  })

  it('keeps to the range, both ends included', async () => {
    const history = await open()
    for (const ts of ['14:22:59', '14:23:00', '14:23:30', '14:24:00', '14:24:01']) {
      history.append(telemetry(`2026-10-05T${ts}Z`))
    }

    const records = history.query({ from: '2026-10-05T14:23:00Z', to: '2026-10-05T14:24:00Z' })

    expect(records.map((record) => record.payload.ts)).toEqual([
      '2026-10-05T14:23:00Z',
      '2026-10-05T14:23:30Z',
      '2026-10-05T14:24:00Z',
    ])
  })

  it('sorts by date, whatever order the records came in', async () => {
    const history = await open()
    history.append(alert('2026-10-05T14:23:05Z'))
    history.append(telemetry('2026-10-05T14:23:00Z'))
    history.append(telemetry('2026-10-05T14:23:10Z'))

    const records = history.query(WHOLE_DAY)

    expect(records.map((record) => record.payload.ts)).toEqual([
      '2026-10-05T14:23:00Z',
      '2026-10-05T14:23:05Z',
      '2026-10-05T14:23:10Z',
    ])
  })

  it('sorts by instant, fractions of a second included', async () => {
    const history = await open()
    history.append(telemetry('2026-10-05T14:23:00.500Z'))
    history.append(telemetry('2026-10-05T14:23:00Z'))
    history.append(telemetry('2026-10-05T14:23:00.25Z'))

    const records = history.query({ from: '2026-10-05T14:23:00Z', to: '2026-10-05T14:23:00.5Z' })

    expect(records.map((record) => record.payload.ts)).toEqual([
      '2026-10-05T14:23:00Z',
      '2026-10-05T14:23:00.25Z',
      '2026-10-05T14:23:00.500Z',
    ])
  })

  it('keeps records sharing a date in the order they were appended', async () => {
    const history = await open()
    const ts = '2026-10-05T14:23:05Z'
    history.append(telemetry(ts, 420))
    history.append(alert(ts))
    history.append(telemetry(ts, 450))

    expect(history.query(WHOLE_DAY)).toEqual([telemetry(ts, 420), alert(ts), telemetry(ts, 450)])
  })

  it('gives back nothing, not an error, for a range where nothing happened', async () => {
    const history = await open()
    history.append(telemetry('2026-10-05T14:23:00Z'))

    expect(history.query({ from: '2026-10-06T00:00:00Z', to: '2026-10-06T01:00:00Z' })).toEqual([])
  })

  it('gives back every Alert, without the telemetry, in the order of the records', async () => {
    const history = await open()
    history.append(alert('2026-10-05T14:23:10Z'))
    history.append(telemetry('2026-10-05T14:23:00Z'))
    history.append({ type: 'alert', payload: intrusionAlert({ ts: '2026-10-05T14:23:05Z' }) })
    history.append({ type: 'alert', payload: gasAlert({ state: 'cleared', ts: '2026-10-05T14:23:05Z' }) })

    expect(history.alerts()).toEqual([
      intrusionAlert({ ts: '2026-10-05T14:23:05Z' }),
      gasAlert({ state: 'cleared', ts: '2026-10-05T14:23:05Z' }),
      gasAlert({ ts: '2026-10-05T14:23:10Z' }),
    ])
  })

  it('is not changed by what a caller does with the records', async () => {
    const history = await open()
    const record = telemetry('2026-10-05T14:23:00Z', 180)
    history.append(record)

    record.payload.sentinel = 'tampered'
    const [first] = history.query(WHOLE_DAY)
    if (first) first.payload.sentinel = 'tampered too'

    expect(history.query(WHOLE_DAY)).toEqual([telemetry('2026-10-05T14:23:00Z', 180)])
  })
})

describe('history in SQLite', () => {
  it('keeps the records across a restart', async () => {
    const file = join(await scratchDirectory(), 'history.sqlite')
    const before = openSqliteHistory(file)
    before.append(telemetry('2026-10-05T14:23:00Z'))
    before.append(alert('2026-10-05T14:23:05Z'))
    before.close()

    const after = openSqliteHistory(file)
    onTestFinished(() => after.close())

    expect(after.query(WHOLE_DAY)).toEqual([telemetry('2026-10-05T14:23:00Z'), alert('2026-10-05T14:23:05Z')])
  })

  it('creates the directory of its file', async () => {
    const history = openSqliteHistory(join(await scratchDirectory(), 'data', 'history.sqlite'))
    onTestFinished(() => history.close())

    history.append(telemetry('2026-10-05T14:23:00Z'))

    expect(history.query(WHOLE_DAY)).toHaveLength(1)
  })
})
