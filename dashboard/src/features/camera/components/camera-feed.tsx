import { useEffect, useState } from 'react'
import { LevelBadge } from '@/shared/components/level-badge'
import type { Alert } from '@/shared/contract'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'

// The annotated MJPEG stream of the `vision` service, behind the reverse proxy and the Operator
// session, on the app's own origin (the Vite proxy forwards it to CAMERA_URL in dev).
export const CAMERA_PATH = '/camera'
const RETRY_MS = 5_000

type Feed = 'loading' | 'live' | 'down'
export type Intrusion = Extract<Alert, { kind: 'intrusion' }>

export interface Camera {
  feed: Feed
  // A new URL per attempt, or the browser would not ask again.
  attempt: number
  setFeed: (feed: Feed) => void
}

// The state of one view of the stream: asked again a moment after it went down.
export function useCamera(): Camera {
  const [feed, setFeed] = useState<Feed>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (feed !== 'down') return
    const retry = setTimeout(() => {
      setFeed('loading')
      setAttempt((previous) => previous + 1)
    }, RETRY_MS)
    return () => clearTimeout(retry)
  }, [feed])

  return { feed, attempt, setFeed }
}

// Whether the picture shown is the camera's, now.
export function CameraBadge({ camera }: { camera: Camera }) {
  return camera.feed === 'live' ? (
    <LevelBadge tone="nominal">En direct</LevelBadge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Hors ligne
    </Badge>
  )
}

// The live camera, with the intruder the vision AI sees marked where it stands.
export function CameraFeed({ camera, intrusion }: { camera: Camera; intrusion: Intrusion | null }) {
  const { feed, attempt, setFeed } = camera
  return (
    <div className={cn('relative aspect-4/3 overflow-hidden rounded-lg border bg-muted/40', intrusion && 'border-critical')}>
      <img
        key={attempt}
        src={`${CAMERA_PATH}?attempt=${attempt}`}
        alt="Caméra de l'avant-poste en direct"
        className={cn('size-full object-cover', feed !== 'live' && 'invisible')}
        onLoad={() => setFeed('live')}
        onError={() => setFeed('down')}
      />

      {feed !== 'live' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          {feed === 'loading' ? 'Connexion à la caméra…' : 'Flux caméra indisponible, nouvelle tentative…'}
        </div>
      )}

      {intrusion && (
        <>
          <div className="absolute inset-y-0 w-px bg-critical" style={{ left: `${intrusion.detail.x_norm * 100}%` }} />
          <Badge className="absolute top-3 left-3 bg-background/90 text-foreground">
            <span aria-hidden className="text-critical">
              ●
            </span>
            Intrus détecté · {Math.round(intrusion.detail.confidence * 100)} %
          </Badge>
        </>
      )}
    </div>
  )
}
