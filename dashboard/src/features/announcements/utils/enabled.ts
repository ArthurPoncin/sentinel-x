import { rememberedSwitch } from '@/shared/lib/remembered-switch'

// The built-in voice is off until the Operator switches it on: a dashboard never starts talking by itself. Its
// own switch, kept by the browser: it owes nothing to the voice control, which listens.
export const { read: readEnabled, write: writeEnabled } = rememberedSwitch('sentinel-x:announcements')
