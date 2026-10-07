// Public API of the actuators feature: import from '@/features/actuators', never from its folders.
export { ActuatorPanel } from './components/actuator-panel'
// The same commands without the panel, for what else drives the Alarm: a gesture over the hand sensor.
export { type Fired, firePreset } from './api/commands-client'
export type { PresetId } from './utils/commands'
