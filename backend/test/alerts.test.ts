import { describe, expect, it, vi } from 'vitest'
import { createAlertPipeline, normalizeAlert } from '../src/alerts.js'
import type { Alert, Frame } from '../src/contract.js'
import { createMemoryHistory, type HistoryRepository } from '../src/history.js'
import { gasAlert, intrusionAlert } from './support/alerts.js'

describe('normalizeAlert', () => {
  it('gives the same Alert whichever ingress path carried it', () => {
    const { sentinel: _sentinel, source: _source, ...fromTopic } = gasAlert()

    const overMqtt = normalizeAlert(fromTopic, { source: 'esp32', sentinel: 'sentinel-01' })
    const overHttp = normalizeAlert(gasAlert())

    expect(overMqtt).toEqual({ success: true, data: gasAlert() })
    expect(overHttp).toEqual(overMqtt)
  })

  it('believes the channel over the payload', () => {
    const claimed = { ...gasAlert(), source: 'vision', sentinel: 'sentinel-99' }

    const normalized = normalizeAlert(claimed, { source: 'esp32', sentinel: 'sentinel-01' })

    expect(normalized.data).toEqual(gasAlert())
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'gas'],
    ['a list', [gasAlert()]],
    ['an empty object', {}],
    ['an unknown field', { ...gasAlert(), firmware: '1.0.0' }],
    ['a missing field', { ...gasAlert(), severity: undefined }],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeAlert(raw, { source: 'esp32', sentinel: 'sentinel-01' }).success).toBe(false)
  })
})

describe('alert pipeline', () => {
  function startPipeline(history: HistoryRepository = createMemoryHistory()) {
    const frames: Frame[] = []
    const pipeline = createAlertPipeline({ broadcast: (frame) => frames.push(frame) }, history)
    // The Status after each accepted Alert, oldest first.
    const statuses = () => frames.flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))
    return { pipeline, frames, statuses }
  }

  function accept(pipeline: ReturnType<typeof startPipeline>['pipeline'], ...alerts: Alert[]) {
    for (const alert of alerts) pipeline.accept(alert)
  }

  it('records every Alert in the history, cleared ones included', () => {
    const history = createMemoryHistory()
    const { pipeline } = startPipeline(history)

    pipeline.accept(gasAlert())
    pipeline.accept(gasAlert({ state: 'cleared', ts: '2026-10-05T14:24:00Z' }))

    expect(history.query({ from: '2026-10-05T14:00:00Z', to: '2026-10-05T15:00:00Z' })).toEqual([
      { type: 'alert', payload: gasAlert() },
      { type: 'alert', payload: gasAlert({ state: 'cleared', ts: '2026-10-05T14:24:00Z' }) },
    ])
  })

  it('still broadcasts an Alert the history cannot take, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken: HistoryRepository = {
      append: () => {
        throw new Error('database or disk is full')
      },
      query: () => [],
    }
    const { pipeline, frames } = startPipeline(broken)

    pipeline.accept(gasAlert())

    expect(frames).toMatchObject([{ type: 'alert' }, { type: 'status', payload: { status: 'elevated' } }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database or disk is full'))
    warn.mockRestore()
  })

  it('broadcasts the Alert, then the Status it leads to', () => {
    const { pipeline, frames } = startPipeline()

    pipeline.accept(gasAlert())

    expect(frames).toMatchObject([
      { type: 'alert', payload: gasAlert() },
      { type: 'status', payload: { status: 'elevated' } },
    ])
  })

  it('pairs a cleared with the raised of the same alert_id', () => {
    const { pipeline, statuses } = startPipeline()

    accept(pipeline, intrusionAlert(), intrusionAlert({ state: 'cleared' }))

    expect(statuses()).toEqual(['critical', 'nominal'])
  })

  it('holds the Status while another Alert is still raised', () => {
    const { pipeline, statuses } = startPipeline()

    accept(
      pipeline,
      gasAlert(),
      intrusionAlert(),
      intrusionAlert({ state: 'cleared' }),
      gasAlert({ state: 'cleared' }),
    )

    expect(statuses()).toEqual(['elevated', 'critical', 'elevated', 'nominal'])
  })

  it('leaves the Status alone on a cleared that pairs with nothing', () => {
    const { pipeline, frames, statuses } = startPipeline()
    const orphan = gasAlert({ alert_id: 'never-raised', state: 'cleared' })

    accept(pipeline, intrusionAlert(), orphan)

    expect(statuses()).toEqual(['critical', 'critical'])
    expect(frames).toContainEqual({ type: 'alert', payload: orphan })
  })

  it('takes a raised on a known alert_id as that Alert changing, not as a second one', () => {
    const { pipeline, statuses } = startPipeline()

    accept(pipeline, gasAlert(), gasAlert({ severity: 'critical' }), gasAlert({ state: 'cleared' }))

    expect(statuses()).toEqual(['elevated', 'critical', 'nominal'])
  })
})
