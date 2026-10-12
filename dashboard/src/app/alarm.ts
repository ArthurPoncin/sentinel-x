import { toast } from 'sonner'
import { firePreset, type PresetId } from '@/features/actuators'
import type { Action } from '@/features/gestures'
import type { Command } from '@/features/voice'
import { inTutorial } from './app-sidebar'

// The Alarm's command a thumb stands for: raised, all is well and the siren stops; turned down, it sounds.
const OF_GESTURE: Partial<Record<Action, PresetId>> = { 'all-clear': 'siren-off', alarm: 'siren' }

// The Alarm's command a voice command stands for: the panel's own, for those that are about the Alarm.
const OF_VOICE: Partial<Record<Command, PresetId>> = { siren: 'siren', 'siren-off': 'siren-off' }

// What a gesture made at `pathname` asks of the Alarm. Nothing in the tutorial: a gesture is tried there,
// not meant.
export function presetOfGesture(action: Action, pathname: string): PresetId | null {
  return inTutorial(pathname) ? null : (OF_GESTURE[action] ?? null)
}

// What a voice command said at `pathname` asks of the Alarm, nothing when it is about something else. The
// tutorial's rule holds for the voice too.
export function presetOfVoice(command: Command, pathname: string): PresetId | null {
  return inTutorial(pathname) ? null : (OF_VOICE[command] ?? null)
}

// What the Operator did not press a button for.
const BY = { hand: 'Geste reconnu', voice: 'Commande vocale' } as const

// How it went, for a toast.
export interface Answer {
  success: boolean
  title: string
  description: string
}

// How a command for the Alarm went, in a toast: the same for a gesture and for the voice.
export function answer({ success, title, description }: Answer) {
  return success ? toast.success(title, { description }) : toast.error(title, { description })
}

// Drives the Sentinel's Alarm as a press on the actuator panel does, and says how it went with the panel's
// own words, and by what it came.
export async function driveAlarm(sentinel: string | null, preset: PresetId, by: keyof typeof BY): Promise<Answer> {
  const fired = await firePreset(sentinel, preset)
  if (!fired.success) return fired
  return { success: true, title: fired.label, description: `${BY[by]} · commande transmise à ${fired.command.sentinel}` }
}
