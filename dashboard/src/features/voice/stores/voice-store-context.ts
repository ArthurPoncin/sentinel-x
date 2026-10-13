import { createContext } from 'react'
import type { Failure } from '../api/ear'
import type { VoiceStore } from './voice-store'

export interface VoiceControl {
  store: VoiceStore
  // Whether the Operator switched the voice control on, on this browser.
  enabled: boolean
  setEnabled(enabled: boolean): void
  // Why it went back to off by itself, until it is switched on again.
  failure: Failure | null
}

export const VoiceControlContext = createContext<VoiceControl | null>(null)
