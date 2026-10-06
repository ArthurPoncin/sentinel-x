import { cn } from '@/shared/lib/utils'
import type { ConnectionState } from '../api/feed-client'
import { useLiveFeed } from '../hooks/use-live-feed'

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connexion…',
  open: 'En direct',
  closed: 'Hors ligne',
}

const DOT: Record<ConnectionState, string> = {
  connecting: 'bg-elevated',
  open: 'bg-nominal',
  closed: 'bg-critical',
}

export function ConnectionIndicator() {
  const connection = useLiveFeed((state) => state.connection)
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground" data-connection={connection}>
      <span className={cn('size-1.5 rounded-full', DOT[connection])} />
      {LABEL[connection]}
    </span>
  )
}
