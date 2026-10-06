// Public API of the replay feature: import from '@/features/replay', never from its folders.
export { TimeScrubber, type TimeScrubberProps } from './components/time-scrubber'
export { type Player, usePlayer } from './hooks/use-player'
// Pure: the Incidents of a history and what is replayed of one at a given second.
export { incidents } from './utils/incidents'
export { framesAt, type Replay, replayOf } from './utils/replay'
export { scenario, scenarioFrames } from './utils/scenario'
