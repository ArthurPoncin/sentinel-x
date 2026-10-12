import { createContext } from 'react'
import type { VoiceStore } from './voice-store'

export interface VoiceControl {
  store: VoiceStore
  // Whether the Operator switched the voice control on, on this browser.
  enabled: boolean
  setEnabled(enabled: boolean): void
}

export const VoiceControlContext = createContext<VoiceControl | null>(null)
