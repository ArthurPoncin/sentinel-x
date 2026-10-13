import { VoiceTutorial } from '@/features/voice'

// The voice control's tutorial: every command the dashboard answers to, how to say it, and what the ear makes
// of what is said. In the menu only while the voice control is on; opened without it, it says how to switch it
// on, and what to do about a microphone that was refused.
export function VoiceTutorialRoute() {
  return <VoiceTutorial />
}
