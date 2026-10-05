import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react'
import type { StatusLevel } from '@/shared/contract'
import { toneOfStatus, toneSurface } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent } from '@/shared/ui/card'
import { STATUS_LABEL, STATUS_MEANING } from '../utils/labels'

const ICON = { nominal: ShieldCheck, elevated: ShieldAlert, critical: ShieldX } as const

interface StatusPanelProps {
  status: StatusLevel
  // The Status is the backend's: without the feed, the last one we heard may be stale.
  feed: 'connecting' | 'open' | 'closed'
  activeAlerts: number
  className?: string
}

// The Outpost's headline state, as the Command Post computes it. Readable from across the room.
export function StatusPanel({ status, feed, activeAlerts, className }: StatusPanelProps) {
  const live = feed === 'open'
  const Icon = live ? ICON[status] : ShieldQuestion

  return (
    <Card className={cn('justify-center border-2 py-4', live ? toneSurface[toneOfStatus[status]] : 'border-dashed', className)}>
      <CardContent className="flex items-center gap-4 px-5">
        <Icon className={cn('size-12 shrink-0', live && status === 'critical' && 'animate-pulse')} />
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-widest uppercase opacity-80">Outpost Status</p>
          <p className="text-3xl font-bold tracking-tight" data-status={live ? status : undefined}>
            {live ? STATUS_LABEL[status] : feed === 'connecting' ? 'Connecting…' : 'Signal lost'}
          </p>
          <p className="text-sm text-muted-foreground">
            {live
              ? `${STATUS_MEANING[status]} · ${activeAlerts} active Alert${activeAlerts === 1 ? '' : 's'}`
              : feed === 'connecting'
                ? 'Reaching the Command Post'
                : 'No feed from the Command Post: last state unknown'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
