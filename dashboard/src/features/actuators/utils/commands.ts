import { type CommandRequest, CommandRequestSchema } from '@/shared/contract'

export type PresetId = 'siren' | 'siren-off'

export interface Preset {
  id: PresetId
  label: string
  // What the Operator is asking the Sentinel for, without the Sentinel itself.
  command: Omit<CommandRequest, 'sentinel'>
}

// The two actions the Operator needs in the demo: sound the siren, silence it. The pattern name is the firmware's.
export const PRESETS: readonly Preset[] = [
  { id: 'siren', label: 'Déclencher la sirène', command: { actuator: 'buzzer', action: 'pattern', params: { pattern: 'siren' } } },
  { id: 'siren-off', label: 'Couper la sirène', command: { actuator: 'buzzer', action: 'off' } },
]

export type Built = { success: true; request: CommandRequest } | { success: false; reason: string }

// The request for a preset, checked against the contract before it leaves: without a known
// Sentinel, or with one the API would refuse, nothing is sent.
export function buildCommand(sentinel: string | null, preset: Preset): Built {
  if (sentinel === null) return { success: false, reason: 'Aucun Sentinel connecté pour le moment.' }
  const parsed = CommandRequestSchema.safeParse({ sentinel, ...preset.command })
  return parsed.success
    ? { success: true, request: parsed.data }
    : { success: false, reason: `Commande invalide : ${parsed.error.issues[0]?.message ?? 'raison inconnue'}` }
}

// Why POST /api/v1/commands turned a command down, in the Operator's words.
export function commandFailure(status: number): string {
  switch (status) {
    case 400:
      return 'Le poste de commande a refusé une commande mal formée.'
    case 401:
      return 'La session a expiré. Reconnectez-vous.'
    case 429:
      return 'Trop rapide : deux commandes par seconde au maximum.'
    case 503:
      return "Le broker est injoignable : la commande n'a pas atteint le Sentinel."
    default:
      return 'Le poste de commande ne répond pas.'
  }
}
