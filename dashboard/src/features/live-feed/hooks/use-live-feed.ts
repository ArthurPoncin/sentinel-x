import { useContext, useSyncExternalStore } from 'react'
import type { FeedState } from '../stores/feed-store'
import { FeedStoreContext } from '../stores/feed-store-context'

// Reads the live state and re-renders when the selected part changes, e.g.
// `useLiveFeed((state) => state.status)`. Select a field as is: derive anything else with useMemo,
// since a selector that builds a new object or array on every call re-renders forever.
export function useLiveFeed<T>(select: (state: FeedState) => T): T {
  const store = useContext(FeedStoreContext)
  if (!store) throw new Error('useLiveFeed must be used inside <LiveFeedProvider>')
  return useSyncExternalStore(store.subscribe, () => select(store.getState()))
}
