// Public API of the twin feature: import from '@/features/twin', never from its folders.
export { OutpostTwin, type OutpostTwinProps } from './components/outpost-twin'
// Pure, for whoever feeds the Twin (the live route, the time-scrubber's replays).
export { type SceneProps, type TwinFeed, type TwinState, toScene } from './utils/scene'
// What a hand sensor gives the Twin: the route hands it over from whoever reads the sensor.
// What is laid over the Twin on the screen, which that hand's sight designates and its shot hits.
export type { Pane, Panes } from './utils/panes'
export type { HandAim, HandShot, HandSteer, HandTint, OperatorHands, SensedHand } from './utils/operator-hands'
