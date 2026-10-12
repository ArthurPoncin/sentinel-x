import { useEffect, useMemo, useState } from 'react'
import type { Alert, Frame } from '@/shared/contract'
import { clock, duration } from '@/shared/lib/format'
import { VECTOR_LABEL } from '@/shared/lib/labels'
import { attacks } from '../utils/attacks'

// How often a live attack's duration is read again.
const TICK_MS = 1000

// The instant the durations are counted to: the one given, or the present, read again every second.
function useInstant(at: number | undefined): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (at !== undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [at])
  return at ?? now
}

export interface AttackListProps {
  // The active Alerts of what is shown, and the frames it was built from.
  alerts: readonly Alert[]
  frames: readonly Frame[]
  // The instant shown, in ms since the epoch, where it is not the present: the replayed one.
  at?: number
}

// The attacks going on in figures, with no card around them, for what brings its own frame: the entry point
// attacked, where it comes from when it is known, the attempts refused, and since when. With none, it says so.
export function AttackList({ alerts, frames, at }: AttackListProps) {
  const going = useMemo(() => attacks(alerts, frames), [alerts, frames])
  const now = useInstant(at)

  if (going.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucune attaque en cours.</p>
  }

  return (
    <ul className="flex flex-col divide-y">
      {going.map(({ alertId, vector, address, attempts, since }) => (
        <li key={alertId} className="py-3 first:pt-0 last:pb-0">
          <p className="text-sm font-medium">Attaque sur {VECTOR_LABEL[vector]}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] items-baseline gap-x-3 text-sm">
            {address !== undefined && (
              <>
                <dt className="text-muted-foreground">Origine</dt>
                <dd className="break-all tabular-nums">{address}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Tentatives refusées</dt>
            <dd className="tabular-nums">{attempts}</dd>
            <dt className="text-muted-foreground">Depuis</dt>
            <dd className="tabular-nums">
              {clock(since)} · {duration(now - since)}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}
