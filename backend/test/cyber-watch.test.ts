import { describe, expect, it } from 'vitest'
import { AlertSchema, COMMAND_POST } from '../src/contract.js'
import { createCyberWatch, QUIET_MS, THRESHOLD, WINDOW_MS } from '../src/cyber-watch.js'

// A watch on a clock the test moves, in milliseconds.
function startWatch() {
  const clock = { now: Date.parse('2026-10-05T14:23:00Z') }
  const watch = createCyberWatch(() => clock.now)
  // `count` refusals on the login, `everyMs` apart: the Alerts they gave, in order.
  const refuse = (count: number, everyMs = 0) =>
    Array.from({ length: count }, (_, index) => {
      if (index > 0) clock.now += everyMs
      return watch.refused('login')
    }).flat()
  return { clock, watch, refuse }
}

describe('cyber watch', () => {
  it('raises nothing on one refusal', () => {
    const { refuse, watch } = startWatch()

    expect(refuse(1)).toEqual([])
    expect(watch.settle()).toEqual([])
  })

  it('raises a cyber Alert once the refusals reach the threshold within the window', () => {
    const { refuse } = startWatch()

    expect(refuse(THRESHOLD - 1, 100)).toEqual([])
    const [alert, ...rest] = refuse(1)

    expect(rest).toEqual([])
    expect(alert).toEqual({
      alert_id: expect.stringMatching(/^cyber-login-/),
      sentinel: COMMAND_POST,
      source: 'api',
      kind: 'cyber',
      severity: 'warning',
      state: 'raised',
      value: THRESHOLD,
      detail: { vector: 'login', attempts: THRESHOLD },
      ts: '2026-10-05T14:23:00.300Z',
    })
    expect(AlertSchema.safeParse(alert).success).toBe(true)
  })

  it('raises nothing on refusals spread beyond the window', () => {
    const { refuse } = startWatch()

    expect(refuse(THRESHOLD * 3, WINDOW_MS / (THRESHOLD - 1))).toEqual([])
  })

  it('raises the Alert again on each further refusal, same alert_id, the count up to date', () => {
    const { refuse } = startWatch()
    const [raised] = refuse(THRESHOLD)

    const further = refuse(3, 200)

    expect(further.map((alert) => alert.alert_id)).toEqual(Array(3).fill(raised?.alert_id))
    expect(further.map((alert) => alert.state)).toEqual(['raised', 'raised', 'raised'])
    expect(further.map((alert) => alert.value)).toEqual([THRESHOLD + 1, THRESHOLD + 2, THRESHOLD + 3])
    expect(further.map((alert) => alert.kind === 'cyber' && alert.detail.attempts)).toEqual(
      further.map((alert) => alert.value),
    )
  })

  it('clears the Alert after the quiet time, and not before', () => {
    const { clock, refuse, watch } = startWatch()
    const [raised] = refuse(THRESHOLD + 2)

    clock.now += QUIET_MS - 1
    expect(watch.settle()).toEqual([])
    clock.now += 1
    const cleared = watch.settle()

    expect(cleared).toEqual([
      {
        ...raised,
        state: 'cleared',
        value: THRESHOLD + 2,
        detail: { vector: 'login', attempts: THRESHOLD + 2 },
        ts: new Date(clock.now).toISOString(),
      },
    ])
    expect(watch.settle()).toEqual([])
  })

  it('counts the quiet time from the last refusal', () => {
    const { clock, refuse, watch } = startWatch()
    refuse(THRESHOLD)

    clock.now += QUIET_MS - 1
    refuse(1)
    clock.now += QUIET_MS - 1

    expect(watch.settle()).toEqual([])
  })

  it('opens a new Alert, under another alert_id, when the attack resumes after the clearing', () => {
    const { clock, refuse, watch } = startWatch()
    const [first] = refuse(THRESHOLD)
    clock.now += QUIET_MS
    watch.settle()

    expect(refuse(THRESHOLD - 1)).toEqual([])
    const [second] = refuse(1)

    expect(second).toMatchObject({ state: 'raised', value: THRESHOLD })
    expect(second?.alert_id).not.toBe(first?.alert_id)
  })

  it('clears an Alert whose quiet time is over before it counts the refusal that comes then', () => {
    const { clock, refuse } = startWatch()
    const [raised] = refuse(THRESHOLD)

    clock.now += QUIET_MS
    const alerts = refuse(1)

    expect(alerts).toMatchObject([{ alert_id: raised?.alert_id, state: 'cleared' }])
  })
})
