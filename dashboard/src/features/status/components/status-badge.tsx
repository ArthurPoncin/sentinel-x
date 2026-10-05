import type { StatusLevel } from '@/shared/contract'
import { toneDot, toneOfStatus, toneSurface } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { STATUS_LABEL } from '../utils/labels'

// The Status in the top bar, on every screen.
export function StatusBadge({ status }: { status: StatusLevel }) {
  const tone = toneOfStatus[status]
  return (
    <Badge variant="outline" className={cn('h-6 gap-1.5 px-2.5', toneSurface[tone])} data-status={status}>
      <span className={cn('size-2 rounded-full', toneDot[tone], status === 'critical' && 'animate-pulse')} />
      {STATUS_LABEL[status]}
    </Badge>
  )
}
