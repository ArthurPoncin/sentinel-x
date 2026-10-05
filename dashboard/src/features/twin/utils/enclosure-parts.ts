// The Enclosure's parts that react, by the name they carry in the scene: the later Twin slices find
// and drive them by it (scene.getObjectByName), the predictive pulse, the PIR flash, the alarm.
export const ENCLOSURE_PARTS = {
  // Probes
  dht22: 'probe-dht22',
  mq2: 'probe-mq2',
  pir: 'probe-pir',
  mic: 'probe-mic',
  // Actuators
  ledRing: 'actuator-led-ring',
  buzzer: 'actuator-buzzer',
  // What it shows and sees with
  lcd: 'lcd',
  camera: 'camera-lens',
} as const

export type EnclosurePart = keyof typeof ENCLOSURE_PARTS

// What the Enclosure has engraved on its body.
export const ENGRAVING = { maker: 'AetherCorp', model: 'SENTINEL-X', serial: 'SN SX-01-2026-0001' } as const
