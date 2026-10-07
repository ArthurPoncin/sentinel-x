import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connectHands } from '../api/hand-client'
import { HAND_BRIDGE_URL } from '../api/hand-frame'
import { createHandStore } from '../stores/hand-store'
import { HandControlContext } from '../stores/hand-store-context'
import { readEnabled, writeEnabled } from '../utils/enabled'
import type { Action } from '../utils/interpret'

// Milliseconds between two looks at whether frames still come.
const TICK_MS = 250

const seconds = () => performance.now() / 1000

interface Props {
  // Told of what a gesture asks for, once each: the Alarm silenced or sounded, a screen to the left or right.
  onAction?: (action: Action) => void
  // Where the hand bridge listens: this machine's, unless a test says otherwise.
  url?: string
  children: ReactNode
}

// The Operator's hands, for every feature below: one socket to the hand bridge on this machine, open only
// while the hand control is switched on.
export function HandControlProvider({ onAction, url = HAND_BRIDGE_URL, children }: Props) {
  const [store] = useState(createHandStore)
  const [enabled, setEnabledState] = useState(() => readEnabled(window.localStorage))
  // The latest `onAction`, so that a new one never opens a new socket.
  const act = useRef(onAction)
  useEffect(() => {
    act.current = onAction
  })

  const setEnabled = useCallback((next: boolean) => {
    writeEnabled(window.localStorage, next)
    setEnabledState(next)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const disconnect = connectHands(url, (event) => store.dispatch(event, seconds()))
    const unsubscribe = store.onAction((action) => act.current?.(action))
    const timer = setInterval(() => store.tick(seconds()), TICK_MS)
    return () => {
      disconnect()
      unsubscribe()
      clearInterval(timer)
      store.reset()
    }
  }, [enabled, url, store])

  const control = useMemo(() => ({ store, enabled, setEnabled }), [store, enabled, setEnabled])
  return <HandControlContext value={control}>{children}</HandControlContext>
}
