// Public API of the twin feature: import from '@/features/twin', never from its folders.
export { OutpostTwin, type OutpostTwinProps } from './components/outpost-twin'
// Pure, for whoever feeds the Twin (the live route, the time-scrubber's replays).
export { type SceneProps, type TwinFeed, type TwinState, toScene } from './utils/scene'
// What a hand sensor gives the Twin: the route hands it over from whoever reads the sensor.
export type { HandAim, HandShot, HandSteer, HandTint, OperatorHands, SensedHand } from './utils/operator-hands'
