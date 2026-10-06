import { cn } from '@/shared/lib/utils'
import type { ConnectionState } from '../api/feed-client'
import { useLiveFeed } from '../hooks/use-live-feed'

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connexion…',
  open: 'En direct',
  closed: 'Hors ligne',
}

const DOT: Record<ConnectionState, string> = {
  connecting: 'text-elevated',
  open: 'text-nominal',
  closed: 'text-critical',
}

// Whether the feed is live, in the top bar: a colored dot and the word, at full strength.
export function ConnectionIndicator() {
  const connection = useLiveFeed((state) => state.connection)
  return (
    <span className="flex items-center gap-1.5 font-medium" data-connection={connection}>
      <span aria-hidden className={cn(DOT[connection], connection === 'connecting' && 'animate-pulse')}>
        ●
      </span>
      {LABEL[connection]}
    </span>
  )
}
