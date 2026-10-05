// Public API of the twin feature: import from '@/features/twin', never from its folders.
export { OutpostTwin, type OutpostTwinProps } from './components/outpost-twin'
// Pure, for whoever feeds the Twin (the live route, the time-scrubber's replays).
export { type SceneProps, type TwinState, toScene } from './utils/scene'
