import { describe, expect, it } from 'vitest'
import { createAlertPipeline, normalizeAlert } from '../src/alerts.js'
import type { Alert, Frame } from '../src/contract.js'
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
  function startPipeline() {
    const frames: Frame[] = []
    const pipeline = createAlertPipeline({ broadcast: (frame) => frames.push(frame) })
    // The Status after each accepted Alert, oldest first.
    const statuses = () => frames.flatMap((frame) => (frame.type === 'status' ? [frame.payload.status] : []))
    return { pipeline, frames, statuses }
  }

  function accept(pipeline: ReturnType<typeof startPipeline>['pipeline'], ...alerts: Alert[]) {
    for (const alert of alerts) pipeline.accept(alert)
  }

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
