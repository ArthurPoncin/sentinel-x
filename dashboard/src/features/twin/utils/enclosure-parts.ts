// The Enclosure's parts that react, by the name they carry in the scene: the later Twin slices find
// and drive them by it (scene.getObjectByName), the PIR flash, the alarm. The predictive pulse names the
// Probes it drives by their key here (DRIVER_PROBES, scene.ts).
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
  // What it talks to the Command Post through
  antenna: 'antenna',
} as const

export type EnclosurePart = keyof typeof ENCLOSURE_PARTS

// What the site plan needs to know of the Enclosure's shape: the scale it is drawn at, and at that scale 1
// the radius of its foot on the ground and where its lens is from the mast's axis, `x` across its front, `y`
// above the ground and `z` out of it. The camera hangs out of the front, on an arm and a servo that turns it:
// its lens is on the axis it turns about, and nothing of the Enclosure is under it, so the field that goes
// down from it does not go through the body.
export const ENCLOSURE_SHAPE = { scale: 1.25, foot: 0.48, lens: { x: -0.38, y: 1.82, z: 0.57 } } as const

// What the Enclosure has engraved on its body.
export const ENGRAVING = { maker: 'AetherCorp', model: 'SENTINEL-X', serial: 'SN SX-01-2026-0001' } as const
