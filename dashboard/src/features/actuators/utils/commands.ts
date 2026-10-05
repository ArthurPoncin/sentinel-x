import { type CommandRequest, CommandRequestSchema } from '@/shared/contract'

export type PresetId = 'siren' | 'buzzer-off' | 'led-red' | 'led-green' | 'leds-off'

export interface Preset {
  id: PresetId
  label: string
  // What the Operator is asking the Sentinel for, without the Sentinel itself.
  command: Omit<CommandRequest, 'sentinel'>
}

// The few actions the Operator needs in the demo. Pattern and LED names are the firmware's.
export const PRESETS: readonly Preset[] = [
  { id: 'siren', label: 'Sound the siren', command: { actuator: 'buzzer', action: 'pattern', params: { pattern: 'siren' } } },
  { id: 'buzzer-off', label: 'Silence the buzzer', command: { actuator: 'buzzer', action: 'off' } },
  { id: 'led-red', label: 'Red LED', command: { actuator: 'led', action: 'on', params: { led: 'red' } } },
  { id: 'led-green', label: 'Green LED', command: { actuator: 'led', action: 'on', params: { led: 'green' } } },
  { id: 'leds-off', label: 'LEDs off', command: { actuator: 'led', action: 'off' } },
]

export type Built = { success: true; request: CommandRequest } | { success: false; reason: string }

// The request for a preset, checked against the contract before it leaves: without a known
// Sentinel, or with one the API would refuse, nothing is sent.
export function buildCommand(sentinel: string | null, preset: Preset): Built {
  if (sentinel === null) return { success: false, reason: 'No Sentinel heard from yet' }
  const parsed = CommandRequestSchema.safeParse({ sentinel, ...preset.command })
  return parsed.success
    ? { success: true, request: parsed.data }
    : { success: false, reason: `Not a valid command: ${parsed.error.issues[0]?.message ?? 'unknown reason'}` }
}

// Why POST /api/v1/commands turned a command down, in the Operator's words.
export function commandFailure(status: number): string {
  switch (status) {
    case 400:
      return 'The Command Post refused the command as malformed.'
    case 401:
      return 'The Operator session expired. Sign in again.'
    case 429:
      return 'Too fast: two commands a second at most.'
    case 503:
      return 'The broker is out of reach: the command did not reach the Sentinel.'
    default:
      return 'The Command Post did not answer.'
  }
}
