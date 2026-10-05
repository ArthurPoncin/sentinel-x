import { CameraOff, ScanEye } from 'lucide-react'
import { useEffect, useState } from 'react'
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
        <CardTitle>Camera</CardTitle>
        <CardDescription>Vision AI, person detection</CardDescription>
        <CardAction>
          {feed === 'live' ? (
            <Badge variant="outline" className="border-critical/40 text-critical">
              <span className="size-1.5 animate-pulse rounded-full bg-critical" />
              REC
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Offline
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'relative aspect-4/3 overflow-hidden rounded-lg border bg-black/60',
            intrusion && 'border-critical ring-2 ring-critical/60',
          )}
        >
          <img
            key={attempt}
            src={`${CAMERA_PATH}?attempt=${attempt}`}
            alt="Live camera of the Outpost"
            className={cn('size-full object-cover', feed !== 'live' && 'invisible')}
            onLoad={() => setFeed('live')}
            onError={() => setFeed('down')}
          />

          {feed !== 'live' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <CameraOff className="size-8" />
              {feed === 'loading' ? 'Connecting to the camera…' : 'Camera feed unavailable, retrying…'}
            </div>
          )}

          {intrusion && (
            <>
              <div
                className="absolute inset-y-0 w-0.5 bg-critical shadow-[0_0_12px_var(--critical)] transition-[left] duration-700"
                style={{ left: `${intrusion.detail.x_norm * 100}%` }}
              />
              <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-critical/85 px-3 py-1.5 text-sm font-semibold text-white">
                <ScanEye className="size-4" />
                Intruder detected · {Math.round(intrusion.detail.confidence * 100)} %
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
