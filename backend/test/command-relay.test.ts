import { describe, expect, it, vi } from 'vitest'
import { type CommandRequest, CommandSchema } from '../src/contract.js'
import { startBroker } from './support/broker.js'
import { startServer } from './support/server.js'

// The broker connection reports to the console: keep the test output clean.
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'log').mockImplementation(() => {})

const TOPIC = 'command/sentinel-01/actuator'

const buzzerOn: CommandRequest = { sentinel: 'sentinel-01', actuator: 'buzzer', action: 'on' }
const buzzerOff: CommandRequest = { ...buzzerOn, action: 'off' }
const redSiren: CommandRequest = {
  sentinel: 'sentinel-01',
  actuator: 'led',
  action: 'pattern',
  params: { pattern: 'siren', led: 'red' },
}

// The API connected to a running broker, ready to relay.
async function startOutpost() {
  const broker = await startBroker()
  const server = await startServer({ mqtt: broker.config })
  await broker.subscribed()
  return { broker, ...server }
}

function commandsIn(payloads: string[]) {
  return payloads.map((payload) => CommandSchema.parse(JSON.parse(payload)))
}

describe('POST /api/v1/commands', () => {
  it('answers 202 once the broker has the command, on the topic of its Sentinel', async () => {
    const { broker, postCommand } = await startOutpost()

    const response = await postCommand(buzzerOn)

    expect(response.status).toBe(202)
    expect(broker.published).toMatchObject([{ topic: TOPIC }])
  })

  it('answers with the command as published: the request, a cmd_id and a ts', async () => {
    const { broker, postCommand } = await startOutpost()

    const command = await (await postCommand(redSiren)).json()

    expect(command).toEqual({ cmd_id: expect.any(String), ...redSiren, ts: expect.any(String) })
    expect(CommandSchema.parse(command)).toEqual(command)
    expect(broker.published).toEqual([{ topic: TOPIC, payload: JSON.stringify(command) }])
  })

  it('hands a subscriber of the command topic exactly the payload published', async () => {
    const { broker, postCommand } = await startOutpost()
    const sentinel = await broker.subscribe(TOPIC)

    await postCommand(redSiren)

    await vi.waitFor(() => expect(sentinel).toHaveLength(1))
    expect(sentinel).toEqual(broker.published.map(({ payload }) => payload))
  })

  it('gives every command its own cmd_id', async () => {
    const { broker, postCommand } = await startOutpost()
    const sentinel = await broker.subscribe(TOPIC)

    await postCommand(buzzerOn)
    await postCommand(buzzerOn)

    await vi.waitFor(() => expect(sentinel).toHaveLength(2))
    const [first, second] = commandsIn(sentinel)
    expect(first?.cmd_id).not.toEqual(second?.cmd_id)
  })

  it('stamps the command with the time it was relayed', async () => {
    const { postCommand } = await startOutpost()
    const before = Date.now()

    const { ts } = CommandSchema.parse(await (await postCommand(buzzerOn)).json())

    expect(Date.parse(ts)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(ts)).toBeLessThanOrEqual(Date.now())
  })

  it('reaches the Sentinel it names and no other', async () => {
    const { broker, postCommand } = await startOutpost()
    const first = await broker.subscribe('command/sentinel-01/actuator')
    const second = await broker.subscribe('command/sentinel-02/actuator')

    await postCommand({ ...buzzerOn, sentinel: 'sentinel-02' })
    await postCommand(buzzerOff)

    await vi.waitFor(() => {
      expect(commandsIn(first)).toMatchObject([buzzerOff])
      expect(commandsIn(second)).toMatchObject([{ ...buzzerOn, sentinel: 'sentinel-02' }])
    })
  })

  describe('refuses and publishes nothing', () => {
    // A refused command must not reach the broker: the next thing it takes is the marker.
    async function expectNothingPublished(body: unknown) {
      const { broker, postCommand } = await startOutpost()

      const response = await postCommand(body)
      await postCommand(buzzerOff)

      expect(commandsIn(broker.published.map(({ payload }) => payload))).toMatchObject([buzzerOff])
      return response
    }

    it.each([
      ['an actuator the Sentinel does not have', { ...buzzerOn, actuator: 'laser' }],
      ['an action the contract does not define', { ...buzzerOn, action: 'toggle' }],
      ['no Sentinel to send it to', { ...buzzerOn, sentinel: undefined }],
      ['a Sentinel id reaching into another topic', { ...buzzerOn, sentinel: 'sentinel-01/actuator' }],
      ['a Sentinel id that is a wildcard', { ...buzzerOn, sentinel: '+' }],
      ['an unknown field', { ...buzzerOn, firmware: '1.0.0' }],
      ['an unknown param', { ...buzzerOn, params: { volume: 11 } }],
      ['a cmd_id of its own', { ...buzzerOn, cmd_id: 'c9f8e7' }],
      ['a ts of its own', { ...buzzerOn, ts: '2026-10-05T14:23:10Z' }],
      ['a list of commands', [buzzerOn]],
    ])('400 on %s', async (_label, body) => {
      const response = await expectNothingPublished(body)

      expect(response.status).toBe(400)
    })

    it('400 names the field it cannot make sense of', async () => {
      const response = await expectNothingPublished({ ...buzzerOn, actuator: 'laser' })

      expect(await response.json()).toMatchObject({ statusCode: 400, message: expect.stringContaining('actuator') })
    })

    it('413 on a body above 1 KB', async () => {
      const response = await expectNothingPublished({ ...buzzerOn, sentinel: 'x'.repeat(1024) })

      expect(response.status).toBe(413)
    })
  })

  describe('when there is no broker to relay to', () => {
    it('503 when the API runs without MQTT', async () => {
      const { postCommand } = await startServer()

      const response = await postCommand(buzzerOn)

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ statusCode: 503 })
    })

    it('still answers 400 to an invalid command', async () => {
      const { postCommand } = await startServer()

      expect((await postCommand({ ...buzzerOn, actuator: 'laser' })).status).toBe(400)
    })

    it('503 while the broker is away, and keeps nothing for when it is back', { timeout: 15_000 }, async () => {
      const { broker, postCommand } = await startOutpost()
      await broker.stop()

      const refused = await postCommand(buzzerOn)

      expect(refused.status).toBe(503)
      await broker.start()
      await broker.subscribed()
      expect((await postCommand(buzzerOff)).status).toBe(202)
      expect(commandsIn(broker.published.map(({ payload }) => payload))).toMatchObject([buzzerOff])
    })

    it('503 when the broker goes away before taking the command, which is never sent again', { timeout: 15_000 }, async () => {
      const { broker, postCommand } = await startOutpost()
      const unanswered = broker.stopAnswering()

      const response = postCommand(buzzerOn)
      await vi.waitFor(() => expect(unanswered).toEqual([TOPIC]))
      await broker.stop()

      expect((await response).status).toBe(503)
      await broker.start()
      await broker.subscribed()
      expect((await postCommand(buzzerOff)).status).toBe(202)
      expect(commandsIn(broker.published.map(({ payload }) => payload))).toMatchObject([buzzerOff])
    })

    it('503 until the broker lets the API in', async () => {
      const broker = await startBroker()
      const { postCommand } = await startServer({ mqtt: { ...broker.config, password: 'not-the-password' } })
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Connection refused')))

      expect((await postCommand(buzzerOn)).status).toBe(503)
      expect(broker.published).toEqual([])
    })
  })
})
