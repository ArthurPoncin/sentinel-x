import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EarEvent, Failure } from '../api/ear'
import { listen } from '../api/vosk-ear'
import { createVoiceStore, type Missed } from '../stores/voice-store'
import { VoiceControlContext } from '../stores/voice-store-context'
import { readEnabled, writeEnabled } from '../utils/enabled'
import type { Command } from '../utils/interpret'

// Milliseconds between two looks at whether the wake window is over.
const TICK_MS = 250

const seconds = () => performance.now() / 1000

interface Props {
  // Told of what a sentence asks for, once each: the Alarm sounded or silenced.
  onCommand?: (command: Command) => void
  // Told why the voice control went back to off: the microphone refused, the model that did not load.
  onFailure?: (failure: Failure) => void
  // Told of a sentence meant as a command that is none: not understood, or not sure enough.
  onMissed?: (missed: Missed) => void
  // Whether the dashboard is talking: while it is, and a short while after, nothing heard is a command.
  talking?: boolean
  // The ear: this machine's microphone heard by the engine, unless a test says otherwise. It asks `deaf`
  // whether what it hears is the dashboard's own voice, and drops it.
  ear?: (emit: (event: EarEvent) => void, deaf: () => boolean) => () => void
  children: ReactNode
}

// The Operator's voice, for every feature below: one ear, open only while the voice control is switched on.
// The microphone is asked for and the model loaded as it is switched on, never before. It does not listen to
// itself: the ear is closed while the dashboard talks.
export function VoiceControlProvider({ onCommand, onFailure, onMissed, talking = false, ear = listen, children }: Props) {
  const [store] = useState(createVoiceStore)
  const [enabled, setEnabledState] = useState(() => readEnabled(window.localStorage))
  // The latest listeners, so that new ones never open a new ear.
  const told = useRef({ onCommand, onFailure, onMissed })
  useEffect(() => {
    told.current = { onCommand, onFailure, onMissed }
  })

  useEffect(() => store.deafen(talking, seconds()), [store, talking])

  const setEnabled = useCallback((next: boolean) => {
    writeEnabled(window.localStorage, next)
    setEnabledState(next)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const unsubscribe = [
      store.onCommand((command) => told.current.onCommand?.(command)),
      store.onMissed((missed) => told.current.onMissed?.(missed)),
      // An ear that could not listen: the switch goes back to off, and whoever shows messages is told why.
      store.onFailure((failure) => {
        setEnabled(false)
        told.current.onFailure?.(failure)
      }),
    ]
    const stop = ear(
      (event) => store.dispatch(event, seconds()),
      () => store.deaf(seconds()),
    )
    const timer = setInterval(() => store.tick(seconds()), TICK_MS)
    return () => {
      stop()
      for (const off of unsubscribe) off()
      clearInterval(timer)
      store.reset()
    }
  }, [enabled, ear, store, setEnabled])

  const control = useMemo(() => ({ store, enabled, setEnabled }), [store, enabled, setEnabled])
  return <VoiceControlContext value={control}>{children}</VoiceControlContext>
}
