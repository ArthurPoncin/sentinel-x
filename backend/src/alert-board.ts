import type { MqttClient } from 'mqtt'
import type { Alert, Severity } from './contract.js'

// Where the Command Post's status screen (infra/screen.py) reads the Alerts that never went through
// the broker: the AI services' and the API's own. The Sentinel's are on its own topic already.
export const ALERT_BOARD_TOPIC = 'command-post/alerts'

// The broker takes no packet above 4096 bytes and drops whoever sends one: the board stays well under.
const BOARD_LIMIT = 3500

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

export interface AlertBoard {
  // Puts up the Alerts raised and not cleared yet, as they are now.
  show(active: readonly Alert[]): void
}

// The board's Alerts, the most severe first, the least severe left out while they do not fit.
function listed(active: readonly Alert[]): string {
  const alerts = active.filter((alert) => alert.source !== 'esp32').sort((a, b) => RANK[a.severity] - RANK[b.severity])
  while (JSON.stringify(alerts).length > BOARD_LIMIT) alerts.pop()
  return JSON.stringify(alerts)
}

// Keeps one retained message on the broker: whoever subscribes gets the whole board at once, and an
// API that starts again wipes what the last one left there.
export function startAlertBoard(client: MqttClient): AlertBoard {
  let alerts = listed([])
  const publish = () => {
    client.publish(ALERT_BOARD_TOPIC, `{"ts":"${new Date().toISOString()}","alerts":${alerts}}`, { retain: true })
  }
  client.on('connect', publish)

  return {
    show(active) {
      const next = listed(active)
      // A Sentinel's Alert changes nothing here.
      if (next === alerts) return
      alerts = next
      // Away, the broker gets the board as it is by then, when it comes back.
      if (client.connected) publish()
    },
  }
}
