import { rememberedSwitch } from '@/shared/lib/remembered-switch'

// The voice control is off until the Operator switches it on: a dashboard without a microphone never asks for
// one. The choice stays with the browser, as the microphone stays with the machine.
export const { read: readEnabled, write: writeEnabled } = rememberedSwitch('sentinel-x:voice-control')
