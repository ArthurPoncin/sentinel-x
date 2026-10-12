import { randomUUID } from 'node:crypto'
import { type Alert, COMMAND_POST, type CyberVector } from './contract.js'

// Refusals on one vector within WINDOW_MS that make an attack: a mistyped password or two raise
// nothing, a brute force raises within a second or two.
export const THRESHOLD = 5
export const WINDOW_MS = 10_000
// Without a refusal for this long, the attack is over.
export const QUIET_MS = 15_000

export interface CyberWatch {
  // Counts a request the API just refused on `vector`, and gives the Alerts to emit for it, in order.
  refused(vector: CyberVector): Alert[]
  // The Alerts to clear by now: those of the attacks that went quiet. To call as time goes by.
  settle(): Alert[]
}

interface Attack {
  alert_id: string
  attempts: number
  // When its last refusal came.
  last: number
}

// Watches what the API refuses, one vector apart from the other. Refusals reaching THRESHOLD within a
// sliding WINDOW_MS raise a `cyber` Alert; each further one raises it again under the same alert_id
// with the count up to date; QUIET_MS without any clears it.
export function createCyberWatch(now: () => number = Date.now): CyberWatch {
  // The refusals of the window, while no attack is going on.
  const recent = new Map<CyberVector, number[]>()
  const attacks = new Map<CyberVector, Attack>()

  // Always a warning: a refused attack is not a compromised site.
  const alertOf = (vector: CyberVector, attack: Attack, state: Alert['state'], at: number): Alert => ({
    alert_id: attack.alert_id,
    sentinel: COMMAND_POST,
    source: 'api',
    kind: 'cyber',
    severity: 'warning',
    state,
    value: attack.attempts,
    detail: { vector, attempts: attack.attempts },
    ts: new Date(at).toISOString(),
  })

  function settle(): Alert[] {
    const at = now()
    const cleared: Alert[] = []
    for (const [vector, attack] of attacks) {
      if (at - attack.last < QUIET_MS) continue
      attacks.delete(vector)
      cleared.push(alertOf(vector, attack, 'cleared', at))
    }
    return cleared
  }

  return {
    refused(vector) {
      // An attack that went quiet is over, even if nobody asked since: this refusal starts afresh.
      const alerts = settle()
      const at = now()

      let attack = attacks.get(vector)
      if (attack) {
        attack.attempts++
        attack.last = at
      } else {
        const window = [...(recent.get(vector) ?? []).filter((earlier) => at - earlier < WINDOW_MS), at]
        recent.set(vector, window)
        if (window.length < THRESHOLD) return alerts

        recent.delete(vector)
        attack = { alert_id: `cyber-${vector}-${randomUUID().slice(0, 8)}`, attempts: window.length, last: at }
        attacks.set(vector, attack)
      }
      return [...alerts, alertOf(vector, attack, 'raised', at)]
    },
    settle,
  }
}
