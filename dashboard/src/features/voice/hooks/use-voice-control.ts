import { useContext, useMemo, useSyncExternalStore } from 'react'
import type { VoiceState } from '../stores/voice-store'
import { type VoiceControl, VoiceControlContext } from '../stores/voice-store-context'

function useControl(): VoiceControl {
  const control = useContext(VoiceControlContext)
  if (!control) throw new Error('The voice control must be used inside <VoiceControlProvider>')
  return control
}

// Reads what the interface shows of the voice control and re-renders when the selected part changes, e.g.
// `useVoiceState((state) => state.status)`. Select a field as is, as with useLiveFeed.
export function useVoiceState<T>(select: (state: VoiceState) => T): T {
  const { store } = useControl()
  return useSyncExternalStore(store.subscribe, () => select(store.getState()))
}

// Whether the voice control is on, the way to switch it, and why it went back to off when it did by itself.
export function useVoiceSwitch(): Pick<VoiceControl, 'enabled' | 'setEnabled' | 'failure'> {
  const { enabled, setEnabled, failure } = useControl()
  return useMemo(() => ({ enabled, setEnabled, failure }), [enabled, setEnabled, failure])
}
