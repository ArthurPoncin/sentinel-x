import { useEffect, useMemo, useReducer } from 'react'
import type { Alert } from '@/shared/contract'
import { NO_WINDOWS_STATE, type WindowEvent, type Windows, windowsAfter } from '../utils/windows'

// The open windows of a screen, and where to send what opens and closes them. The Alerts the screen shows open
// and close theirs: `alerts` are the active ones, and `at` the instant shown when it is not now, in milliseconds
// (the replayed instant of a replay), or null while live. Live, the clock closes a window whose Alert has
// cleared; in a replay, the replayed instants do.
export function useWindows(alerts: readonly Alert[], at: number | null): [Windows, (event: WindowEvent) => void] {
  const [{ open }, send] = useReducer(windowsAfter, NO_WINDOWS_STATE)
  const kinds = useMemo(() => alerts.map((alert) => alert.kind), [alerts])

  useEffect(() => {
    send({ type: 'alerts', kinds, at: at ?? Date.now() })
  }, [kinds, at])

  // The next instant a window closes by itself at, if any.
  const due = open.reduce<number | undefined>(
    (first, { until }) => (until === undefined ? first : Math.min(first ?? until, until)),
    undefined,
  )
  useEffect(() => {
    if (at !== null || due === undefined) return
    // Never before `due`, should the timer fire early: the window would stay, and no other timer would follow.
    const timer = setTimeout(() => send({ type: 'alerts', kinds, at: Math.max(Date.now(), due) }), due - Date.now())
    return () => clearTimeout(timer)
  }, [at, due, kinds])

  return [open, send]
}
