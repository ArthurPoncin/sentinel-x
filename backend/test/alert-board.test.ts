import { describe, expect, it, vi } from 'vitest'
import { ALERT_BOARD_TOPIC } from '../src/alert-board.js'
import { type Alert, AlertSchema } from '../src/contract.js'
import { gasAlert, intrusionAlert, predictiveAlert } from './support/alerts.js'
import { startBroker } from './support/broker.js'
import { startServer } from './support/server.js'

// The broker connection reports to the console: keep the test output clean.
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'log').mockImplementation(() => {})

// The API connected to a running broker, its empty board already up.
async function startOutpost() {
  const broker = await startBroker()
  const server = await startServer({ mqtt: broker.config })
  await broker.subscribed()
  await vi.waitFor(() => expect(broker.boards).toHaveLength(1))
  return { broker, ...server }
}

// The Alerts of a board, as the status screen reads them.
function alertsOf(board: string | undefined): Alert[] {
  const { ts, alerts } = JSON.parse(board ?? '')
  expect(Number.isNaN(Date.parse(ts))).toBe(false)
  return AlertSchema.array().parse(alerts)
}

describe('the Alert board on the broker', () => {
  it('is put up empty as the API reaches the broker', async () => {
    const { broker } = await startOutpost()

    expect(alertsOf(broker.boards[0])).toEqual([])
  })

  it('holds an intrusion as the vision service posted it, where the person is included', async () => {
    const { broker, postAlert } = await startOutpost()
    const intrusion = intrusionAlert()

    await postAlert(intrusion)

    await vi.waitFor(() => expect(broker.boards).toHaveLength(2))
    expect(alertsOf(broker.boards[1])).toEqual([intrusion])
  })

  it('lists the most severe Alert first and drops one once it is cleared', async () => {
    const { broker, postAlert } = await startOutpost()

    await postAlert(predictiveAlert())
    await postAlert(intrusionAlert())
    await postAlert(intrusionAlert({ state: 'cleared' }))

    await vi.waitFor(() => expect(broker.boards).toHaveLength(4))
    expect(broker.boards.slice(1).map((board) => alertsOf(board).map(({ kind }) => kind))).toEqual([
      ['predictive'],
      ['intrusion', 'predictive'],
      ['predictive'],
    ])
  })

  it("leaves the Sentinel's own Alerts out: they are on its topic already", async () => {
    const { broker, postAlert } = await startOutpost()
    const { source: _source, sentinel: _sentinel, ...gas } = gasAlert()

    await broker.publish('sentinel/sentinel-01/alert', JSON.stringify(gas))
    await postAlert(predictiveAlert())

    await vi.waitFor(() => expect(broker.boards).toHaveLength(2))
    expect(alertsOf(broker.boards[1]).map(({ kind }) => kind)).toEqual(['predictive'])
  })

  it('is handed whole to whoever subscribes later', async () => {
    const { broker, postAlert } = await startOutpost()
    await postAlert(intrusionAlert())
    await vi.waitFor(() => expect(broker.boards).toHaveLength(2))

    const screen = await broker.subscribe(ALERT_BOARD_TOPIC)

    await vi.waitFor(() => expect(screen).toHaveLength(1))
    expect(alertsOf(screen[0])).toEqual([intrusionAlert()])
  })

  it('never outgrows what the broker takes in one packet', async () => {
    const { broker, postAlert } = await startOutpost()
    const drivers = Array.from({ length: 40 }, (_, index) => `driver_${index}`)

    for (let index = 0; index < 12; index++) {
      const response = await postAlert({
        ...predictiveAlert({ alert_id: `drift-${index}` }),
        detail: { anomaly_score: 0.9, drivers },
      })
      expect(response.status).toBe(202)
    }

    await vi.waitFor(() => expect(broker.boards.length).toBeGreaterThan(5))
    for (const board of broker.boards) expect(Buffer.byteLength(board)).toBeLessThan(4096)
    expect(alertsOf(broker.boards.at(-1)).length).toBeGreaterThan(0)
  })

  it('is put up again as it is by then when the broker comes back', async () => {
    const { broker, postAlert } = await startOutpost()
    await broker.stop()

    await postAlert(intrusionAlert())
    await broker.start()

    await vi.waitFor(() => expect(broker.boards.length).toBeGreaterThan(1), { timeout: 5000 })
    expect(alertsOf(broker.boards.at(-1))).toEqual([intrusionAlert()])
  })
})
