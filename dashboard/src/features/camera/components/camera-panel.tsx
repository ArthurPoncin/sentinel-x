import { CameraOff, ScanEye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LevelBadge } from '@/shared/components/level-badge'
import type { Alert } from '@/shared/contract'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

// The annotated MJPEG stream of the `vision` service, behind the reverse proxy and the Operator
// session, on the app's own origin (the Vite proxy forwards it to CAMERA_URL in dev).
export const CAMERA_PATH = '/camera'
const RETRY_MS = 5_000

type Feed = 'loading' | 'live' | 'down'
type Intrusion = Extract<Alert, { kind: 'intrusion' }>

// The live camera, with the intruder the vision AI sees marked where it stands.
export function CameraPanel({ intrusion, className }: { intrusion: Intrusion | null; className?: string }) {
  const [feed, setFeed] = useState<Feed>('loading')
  // A new URL per attempt, or the browser would not ask again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (feed !== 'down') return
    const retry = setTimeout(() => {
      setFeed('loading')
      setAttempt((previous) => previous + 1)
    }, RETRY_MS)
    return () => clearTimeout(retry)
  }, [feed])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Caméra</CardTitle>
        <CardDescription>Détection de personnes par l'IA vision</CardDescription>
        <CardAction>
          {feed === 'live' ? (
            <LevelBadge tone="nominal">En direct</LevelBadge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Hors ligne
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
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
              <CameraOff className="size-6" />
              {feed === 'loading' ? 'Connexion à la caméra…' : 'Flux caméra indisponible, nouvelle tentative…'}
            </div>
          )}

          {intrusion && (
            <>
              <div className="absolute inset-y-0 w-px bg-critical" style={{ left: `${intrusion.detail.x_norm * 100}%` }} />
              <Badge className="absolute top-3 left-3 bg-background/90 text-foreground">
                <ScanEye className="text-critical" />
                Intrus détecté · {Math.round(intrusion.detail.confidence * 100)} %
              </Badge>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
