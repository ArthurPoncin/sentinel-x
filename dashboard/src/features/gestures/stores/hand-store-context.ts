import { createContext } from 'react'
import type { HandStore } from './hand-store'

export interface HandControl {
  store: HandStore
  // Whether the Operator switched the hand control on, on this browser.
  enabled: boolean
  setEnabled(enabled: boolean): void
}

export const HandControlContext = createContext<HandControl | null>(null)
