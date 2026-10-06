import { type ReactNode, useEffect, useRef, useState } from 'react'
import { connectFeed } from '../api/feed-client'
import { createFeedStore } from '../stores/feed-store'
import { FeedStoreContext } from '../stores/feed-store-context'

interface Props {
  url: string
  // Told each time the socket goes down, an attempt that fails included. The feed retries on its own
  // whatever is done about it: the one way to stop it is to unmount the provider.
  onDown?: () => void
  children: ReactNode
}

// One socket per window, shared by every feature below it.
export function LiveFeedProvider({ url, onDown, children }: Props) {
  const [store] = useState(createFeedStore)
  // The latest `onDown`, so that a new one never opens a new socket.
  const down = useRef(onDown)
  useEffect(() => {
    down.current = onDown
  })

  useEffect(
    () =>
      connectFeed(
        url,
        (event) => {
          store.dispatch(event)
          if (event.type === 'connection' && event.state === 'closed') down.current?.()
        },
        {
          onMalformed: (data, reason) => console.warn('Dropped a frame outside the contract:', reason, data),
        },
      ),
    [url, store],
  )

  return <FeedStoreContext value={store}>{children}</FeedStoreContext>
}
