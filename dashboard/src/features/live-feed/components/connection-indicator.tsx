import { cn } from '@/shared/lib/utils'
import type { ConnectionState } from '../api/feed-client'
import { useLiveFeed } from '../hooks/use-live-feed'

// In the top bar, in English as it was born.
const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  closed: 'Offline',
}

const DOT: Record<ConnectionState, string> = {
  connecting: 'text-elevated',
  open: 'text-nominal',
  closed: 'text-critical',
}

// Whether the feed is live: a colored dot and the word, at full strength.
export function ConnectionIndicator() {
  const connection = useLiveFeed((state) => state.connection)
  return (
    <span data-connection={connection}>
      <span aria-hidden className={cn('mr-1.5', DOT[connection])}>
        ●
      </span>
      {LABEL[connection]}
    </span>
  )
}
