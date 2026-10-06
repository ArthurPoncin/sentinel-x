# The Digital Twin — our "wow"

A **live 3D replica** of the Sentinel-X outpost rendered in the dashboard (Three.js / react-three-fiber). Real data from every pillar drives the scene in real time. This is what makes the embedded intelligence *visible* to the jury.

## What maps to what

| Real signal (Alert `kind` / telemetry) | Source node | Twin reaction |
|---|---|---|
| Temperature (DHT) | Sentinel | The generator hall's roof glows red as `temp` rises; the air above it ripples while a `thermal` Alert is active |
| Gas (`air`) | Sentinel | Box glows red, a haze around the gas pipe thickens with the reading |
| Presence (`pir`) | Sentinel | The Enclosure's PIR dome blinks, an amber sweep goes round the fence |
| Noise (`noise`) | Sentinel | A wave of light leaves the box and spreads over the socle on each clap, scaled to the Alert's `value` (share of the cycle that was loud) |
| Intrusion (vision) | Command Post (`vision`) | **Intruder marker** placed along the perimeter arc from `x_norm` |
| Predictive drift | Command Post (`predictive`) | The drifting **component pulses orange** *before* the critical threshold |
| `Status` (nominal/elevated/critical) | Command Post | The scene's overall color grade |
| Alarm (buzzer) | Sentinel | LED ring blinks and buzzer sounds while a `gas` or `thermal` Alert is active. The contract does not carry the Alarm's own state: the Twin does not show it silenced by the Operator |

## Signature features

- **Time-scrubber** — replay a past Incident second-by-second, labelled REPLAY. Lets us script the live demo precisely and re-run it if the network hiccups. Built in #15: see [`../dashboard/README.md`](../dashboard/README.md#time-scrubber--featuresreplay).
- **Threat overview** — a single glanceable state fusing cyber + physical + environmental, shown on the twin (not three disconnected widgets).
- **Scenario mode** — a scripted "attack sequence" for the 3-minute live demo and the 60s green-screen teaser. The dashboard plays the reference scenario (gas leak + two PIR detections) on demand, without the network (#15).

## Why it scores

- **Axis 1 (Live demo & integration):** the twin reacting live *is* the proof of end-to-end integration.
- **Axis 3 (Marketing / teaser):** animated 3D over green-screen = strong visual impact in the "Sentinel Drop".
- **Axis 2 (Tech & innovation):** a digital twin fed by encrypted real telemetry reads as genuinely advanced.

## Build notes

- Keep the 3D scene decoupled from data: a small state store (sensor/event feed via WebSocket) → scene subscribes and reacts. Mock the feed so the twin can be built before hardware is ready.
- Low-poly stylized box model (exportable from the Fusion360 CAD used for the physical box) keeps it performant and on-brand.
- Everything reacts to the **same event stream** the real box emits — no fake data path in the final demo.
