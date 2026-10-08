// Public API of the gestures feature: import from '@/features/gestures', never from its folders.
export { HandControlProvider } from './components/hand-control-provider'
export { GestureTutorial } from './components/gesture-tutorial'
export { HandHud } from './components/hand-hud'
export { type LiveHands, useHandState, useHandSwitch, useHandWind, useLiveHands } from './hooks/use-hand-control'
export type { Hand } from './api/hand-frame'
export type { Action, Reading } from './utils/interpret'
