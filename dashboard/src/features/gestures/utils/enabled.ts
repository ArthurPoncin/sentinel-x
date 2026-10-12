import { rememberedSwitch } from '@/shared/lib/remembered-switch'

// The hand control is off until the Operator switches it on: a dashboard without a sensor never looks for
// one. The choice stays with the browser, as the sensor stays with the machine.
export const { read: readEnabled, write: writeEnabled } = rememberedSwitch('sentinel-x:hand-control')
