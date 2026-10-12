// Public API of the voice feature: import from '@/features/voice', never from its folders.
export { VoiceControlProvider } from './components/voice-control-provider'
export { VoiceHud } from './components/voice-hud'
export { useVoiceState, useVoiceSwitch } from './hooks/use-voice-control'
export type { Failure } from './api/ear'
export type { Command, Screen, WindowCommand, WindowName } from './utils/interpret'
export { failureLine } from './utils/lines'
