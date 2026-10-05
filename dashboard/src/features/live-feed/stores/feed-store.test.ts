import { describe, expect, it, vi } from 'vitest'
import type { AlertState, Frame, Severity, StatusLevel } from '@/shared/contract'
import type { FeedEvent } from '../api/feed-client'
import { apply, createFeedStore, HISTORY_LIMIT, initialFeedState } from './feed-store'

const ts = '2026-10-05T14:23:00.000Z'

function telemetry(air: number): Extract<Frame, { type: 'telemetry' }> {
  return {
    type: 'telemetry',
    payload: {
      sentinel: 'sentinel-01',
      ts,
      readings: { temp: 31.2, humidity: 44, air, pir: false, sound: 1350 },
    },
  }
}

function status(level: StatusLevel): Frame {
  return { type: 'status', payload: { status: level, ts } }
}

function gas(alertId: string, severity: Severity, state: AlertState): Extract<Frame, { type: 'alert' }> {
  return {
    type: 'alert',
    payload: {
      alert_id: alertId,
      sentinel: 'sentinel-01',
      source: 'esp32',
      kind: 'gas',
      severity,
      state,
      value: 420,
      detail: {},
      ts,
    },
  }
}

const opened: FeedEvent = { type: 'connection', state: 'open' }
const dropped: FeedEvent = { type: 'connection', state: 'closed' }

const replay = (events: FeedEvent[]) => events.reduce(apply, initialFeedState)

describe('apply', () => {
  it('starts nominal, with nothing received yet', () => {
    expect(initialFeedState).toMatchObject({
      status: 'nominal',
      latestTelemetry: null,
      activeAlerts: [],
      history: [],
    })
  })

  it('initializes from the snapshot the backend sends on connect', () => {
    const snapshot = telemetry(420)
    const state = replay([opened, status('elevated'), snapshot])

    expect(state.connection).toBe('open')
    expect(state.status).toBe('elevated')
    expect(state.latestTelemetry).toEqual(snapshot.payload)
  })

  it('follows the latest telemetry snapshot', () => {
    const state = replay([telemetry(180), telemetry(320), telemetry(480)])

    expect(state.latestTelemetry?.readings.air).toBe(480)
  })

  it('follows the Status the backend computes', () => {
    const state = replay([status('elevated'), status('critical'), status('nominal')])

    expect(state.status).toBe('nominal')
  })

  it('holds a raised Alert as active', () => {
    const raised = gas('a1', 'warning', 'raised')

    expect(replay([raised]).activeAlerts).toEqual([raised.payload])
  })

  it('leaves no active Alert after a raised then a cleared with the same alert_id', () => {
    const state = replay([gas('a1', 'warning', 'raised'), gas('a1', 'warning', 'cleared')])

    expect(state.activeAlerts).toEqual([])
  })

  it('replaces an active Alert raised again on the same alert_id', () => {
    const escalated = gas('a1', 'critical', 'raised')
    const state = replay([gas('a1', 'warning', 'raised'), escalated])

    expect(state.activeAlerts).toEqual([escalated.payload])
  })

  it('keeps the other Alerts active when one clears', () => {
    const thermal = gas('a2', 'warning', 'raised')
    const state = replay([gas('a1', 'warning', 'raised'), thermal, gas('a1', 'warning', 'cleared')])

    expect(state.activeAlerts).toEqual([thermal.payload])
  })

  it('ignores a cleared for an Alert it never saw raised', () => {
    const raised = gas('a1', 'warning', 'raised')
    const state = replay([raised, gas('unknown', 'warning', 'cleared')])

    expect(state.activeAlerts).toEqual([raised.payload])
  })

  it('forgets the active Alerts on reconnect, since they may have cleared meanwhile', () => {
    const latest = telemetry(420)
    const state = replay([opened, gas('a1', 'warning', 'raised'), latest, dropped, opened])

    expect(state.activeAlerts).toEqual([])
    expect(state.latestTelemetry).toEqual(latest.payload)
    expect(state.history).toHaveLength(2)
  })

  it('records every frame in history, oldest first, keeping only the latest ones', () => {
    const frames = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => telemetry(i))
    const state = replay([opened, ...frames])

    expect(state.history).toHaveLength(HISTORY_LIMIT)
    expect(state.history[0]).toBe(frames[5])
    expect(state.history.at(-1)).toBe(frames.at(-1))
  })
})

describe('createFeedStore', () => {
  it('notifies subscribers when the state changes, and only then', () => {
    const store = createFeedStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: 'connection', state: 'connecting' })
    expect(listener).not.toHaveBeenCalled()

    store.dispatch(telemetry(420))
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getState().latestTelemetry?.readings.air).toBe(420)
  })

  it('stops notifying once unsubscribed', () => {
    const store = createFeedStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.dispatch(telemetry(420))

    expect(listener).not.toHaveBeenCalled()
  })
})
