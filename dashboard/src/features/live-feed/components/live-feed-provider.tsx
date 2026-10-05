import { type ReactNode, useEffect, useState } from 'react'
import { connectFeed } from '../api/feed-client'
import { createFeedStore } from '../stores/feed-store'
import { FeedStoreContext } from '../stores/feed-store-context'

// One socket per window, shared by every feature below it.
export function LiveFeedProvider({ url, children }: { url: string; children: ReactNode }) {
  const [store] = useState(createFeedStore)

  useEffect(
    () =>
      connectFeed(url, store.dispatch, {
        onMalformed: (data, reason) => console.warn('Dropped a frame outside the contract:', reason, data),
      }),
    [url, store],
  )

  return <FeedStoreContext value={store}>{children}</FeedStoreContext>
}
