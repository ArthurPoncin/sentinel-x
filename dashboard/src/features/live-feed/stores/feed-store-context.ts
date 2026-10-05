import { createContext } from 'react'
import type { FeedStore } from './feed-store'

export const FeedStoreContext = createContext<FeedStore | null>(null)
