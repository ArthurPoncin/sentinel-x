import type { Telemetry } from './contract.js'
import { type HistoryRepository, keep } from './history.js'
import type { Hub } from './hub.js'

export interface TelemetryPipeline {
  // Takes a valid snapshot in: records it in the history, then broadcasts it.
  accept(telemetry: Telemetry): void
}

export function createTelemetryPipeline(hub: Pick<Hub, 'broadcast'>, history: HistoryRepository): TelemetryPipeline {
  return {
    accept(telemetry) {
      const frame = { type: 'telemetry', payload: telemetry } as const
      keep(history, frame)
      hub.broadcast(frame)
    },
  }
}
