import { postJson } from '@/shared/api/http'
import { type Command, CommandSchema, type CommandRequest } from '@/shared/contract'
import { commandFailure } from '../utils/commands'

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
