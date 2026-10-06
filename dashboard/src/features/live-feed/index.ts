// Public API of the live-feed feature: import from '@/features/live-feed', never from its folders.
export type { ConnectionState, FeedEvent } from './api/feed-client'
export { ConnectionIndicator } from './components/connection-indicator'
export { FeedInspector } from './components/feed-inspector'
export { LiveFeedProvider } from './components/live-feed-provider'
export { useLiveFeed } from './hooks/use-live-feed'
// Pure, for features that rebuild a state from recorded frames (time-scrubber).
export { apply, type FeedState, initialFeedState, stateAfter } from './stores/feed-store'
