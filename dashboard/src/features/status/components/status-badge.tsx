import { LevelBadge } from '@/shared/components/level-badge'
import type { StatusLevel } from '@/shared/contract'
import { STATUS_LABEL } from '@/shared/lib/labels'
import { toneOfStatus } from '@/shared/lib/tone'

// The Status in the header, on every screen.
export function StatusBadge({ status }: { status: StatusLevel }) {
  return (
    <LevelBadge tone={toneOfStatus[status]} className="h-6 px-2.5 text-foreground">
      {STATUS_LABEL[status]}
    </LevelBadge>
  )
}
