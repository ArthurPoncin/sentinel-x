import type { Alert, Frame, StatusLevel, Telemetry } from '@/shared/contract'
import type { ConnectionState, FeedEvent } from '../api/feed-client'

// About 15 minutes of telemetry at one snapshot per second, plus the Alerts around it.
export const HISTORY_LIMIT = 1000

export interface FeedState {
  connection: ConnectionState
  // Computed by the Command Post from its active Alerts; we only follow it.
  status: StatusLevel
  latestTelemetry: Telemetry | null
  // Raised and not cleared yet, in the order they were first raised.
  activeAlerts: readonly Alert[]
  // Every frame received, oldest first, the latest HISTORY_LIMIT only.
  history: readonly Frame[]
}

export const initialFeedState: FeedState = {
  connection: 'connecting',
  status: 'nominal',
  latestTelemetry: null,
  activeAlerts: [],
  history: [],
}

// Same pairing as the Command Post: a raised on a known alert_id replaces it, a cleared removes it.
function track(active: readonly Alert[], alert: Alert): readonly Alert[] {
  const index = active.findIndex((known) => known.alert_id === alert.alert_id)
  if (alert.state === 'cleared') return index === -1 ? active : active.toSpliced(index, 1)
  return index === -1 ? [...active, alert] : active.with(index, alert)
}

function record(history: readonly Frame[], frame: Frame): readonly Frame[] {
  return [...history, frame].slice(-HISTORY_LIMIT)
}

// The whole client-side state is a fold of the feed's events: pure, no socket, no React.
export function apply(state: FeedState, event: FeedEvent): FeedState {
  switch (event.type) {
    case 'connection':
      if (event.state === state.connection) return state
      // A new connection starts over from the backend's snapshot: the Alerts we held may have
      // cleared while we were away, and we would never hear of it.
      return event.state === 'open'
        ? { ...state, connection: 'open', activeAlerts: [] }
        : { ...state, connection: event.state }
    case 'telemetry':
      return { ...state, latestTelemetry: event.payload, history: record(state.history, event) }
    case 'status':
      return { ...state, status: event.payload.status, history: record(state.history, event) }
    case 'alert':
      return {
        ...state,
        activeAlerts: track(state.activeAlerts, event.payload),
        history: record(state.history, event),
      }
  }
}

export interface FeedStore {
  getState(): FeedState
  subscribe(listener: () => void): () => void
  dispatch(event: FeedEvent): void
}

// Holds the state between events, for React to subscribe to (useSyncExternalStore).
export function createFeedStore(initial: FeedState = initialFeedState): FeedStore {
  let state = initial
  const listeners = new Set<() => void>()

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(event) {
      const next = apply(state, event)
      if (next === state) return
      state = next
      for (const listener of listeners) listener()
    },
  }
}
