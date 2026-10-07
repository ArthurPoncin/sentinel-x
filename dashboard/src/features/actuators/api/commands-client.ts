import { postJson } from '@/shared/api/http'
import { type Command, CommandSchema, type CommandRequest } from '@/shared/contract'
import { buildCommand, commandFailure, type PresetId, PRESETS } from '../utils/commands'

export type Sent = { success: true; command: Command } | { success: false; message: string }

// 202 means the broker took the command for the Sentinel; the API gives it back stamped.
export async function sendCommand(request: CommandRequest): Promise<Sent> {
  let response: Response
  try {
    response = await postJson('/api/v1/commands', request)
  } catch {
    return { success: false, message: commandFailure(0) }
  }
  if (response.status !== 202) return { success: false, message: commandFailure(response.status) }
  const parsed = CommandSchema.safeParse(await response.json().catch(() => null))
  return parsed.success
    ? { success: true, command: parsed.data }
    : { success: false, message: "Commande acceptée, mais la réponse du poste de commande est inattendue." }
}

export type Fired =
  | { success: true; label: string; command: Command }
  | { success: false; title: string; description: string }

// Sends a preset to the Sentinel and says how it went, in the Operator's words: what a press of the panel
// does, and what a gesture over the hand sensor does.
export async function firePreset(sentinel: string | null, id: PresetId): Promise<Fired> {
  const preset = PRESETS.find((candidate) => candidate.id === id)
  if (!preset) return { success: false, title: 'Commande non envoyée', description: 'Commande inconnue.' }
  const built = buildCommand(sentinel, preset)
  if (!built.success) return { success: false, title: 'Commande non envoyée', description: built.reason }
  const sent = await sendCommand(built.request)
  return sent.success
    ? { success: true, label: preset.label, command: sent.command }
    : { success: false, title: 'Commande non transmise', description: sent.message }
}
