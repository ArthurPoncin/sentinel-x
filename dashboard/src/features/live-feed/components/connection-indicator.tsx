import type { ConnectionState } from '../api/feed-client'
import { useLiveFeed } from '../hooks/use-live-feed'

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  closed: 'Offline',
}

export function ConnectionIndicator() {
  const connection = useLiveFeed((state) => state.connection)
  return (
    <span className="connection" data-connection={connection}>
      {LABEL[connection]}
    </span>
  )
}
