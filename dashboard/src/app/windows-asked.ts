import { z } from 'zod'
import type { Command, WindowCommand } from '@/features/voice'
import { WINDOW_IDS, type WindowId } from '@/features/windows'
import { inTutorial, inVoiceTutorial, TWIN } from './app-sidebar'

// What the voice asks of the Twin's windows: one opened, one closed, or all of them closed.
const id = z.enum(WINDOW_IDS as [WindowId, ...WindowId[]])
const AskSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), id }),
  z.object({ type: z.literal('close'), id }),
  z.object({ type: z.literal('close-all') }),
])

export type WindowsAsk = z.infer<typeof AskSchema>

// Each window of the catalogue has its two commands: one the voice had no name for would not compile here.
const OF_VOICE = new Map<Command, WindowsAsk>([
  ...WINDOW_IDS.flatMap((id): [WindowCommand, WindowsAsk][] => [
    [`show-${id}`, { type: 'open', id }],
    [`close-${id}`, { type: 'close', id }],
  ]),
  ['close-all', { type: 'close-all' }],
])

// What a voice command said at `pathname` asks of the windows, nothing when it is about something else. A
// window is shown from any screen: the way leads to the Twin. One is closed on the Twin only: there is none
// open anywhere else. The tutorials' rule holds here too: a command is tried there, not meant.
export function windowsOfVoice(command: Command, pathname: string): WindowsAsk | null {
  const ask = OF_VOICE.get(command)
  if (!ask || inTutorial(pathname) || inVoiceTutorial(pathname)) return null
  return ask.type === 'open' || pathname.replace(/\/+$/, '') === TWIN ? ask : null
}

// What the way to the Twin carries when the voice asks something of its windows.
export function windowsAsked(ask: WindowsAsk): { windows: WindowsAsk } {
  return { windows: ask }
}

// What a way to the Twin asks of its windows, or nothing: `state` is the location's, anything at all.
export function askedWindows(state: unknown): WindowsAsk | null {
  if (typeof state !== 'object' || state === null || !('windows' in state)) return null
  const asked = AskSchema.safeParse(state.windows)
  return asked.success ? asked.data : null
}
