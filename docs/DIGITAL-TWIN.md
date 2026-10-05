# The Digital Twin — our "wow"

A **live 3D replica** of the Sentinel-X outpost rendered in the dashboard (Three.js / react-three-fiber). Real data from every pillar drives the scene in real time. This is what makes the embedded intelligence *visible* to the jury.

## What maps to what

| Real signal (Alert `kind` / telemetry) | Source node | Twin reaction |
|---|---|---|
| Temperature / humidity (DHT) | Sentinel | Heat shimmer / color grade on the box; thermal gauge |
| Gas (`air`) | Sentinel | Box glows red, particle haze scales with the reading |
| Presence (`pir`) | Sentinel | Perimeter zone flashes amber |
| Noise (`sound`) | Sentinel | Sound-wave ripples around the box, scaled to the level |
| Intrusion (vision) | Command Post (`vision`) | **Intruder marker** placed along the perimeter arc from `x_norm` |
| Predictive drift | Command Post (`predictive`) | The drifting **component pulses orange** *before* the critical threshold |
| `Status` (nominal/elevated/critical) | Command Post | The scene's overall color grade |
| Alarm state (buzzer/LED) | Sentinel | Twin mirrors the physical box (LED color, buzzer ring) |

## Signature features

- **Time-scrubber** — replay the last N minutes of incidents second-by-second. Lets us script the live demo precisely and re-run it if the network hiccups.
- **Threat overview** — a single glanceable state fusing cyber + physical + environmental, shown on the twin (not three disconnected widgets).
- **Scenario mode** — a scripted "attack sequence" for the 3-minute live demo and the 60s green-screen teaser.

## Why it scores

- **Axis 1 (Live demo & integration):** the twin reacting live *is* the proof of end-to-end integration.
- **Axis 3 (Marketing / teaser):** animated 3D over green-screen = strong visual impact in the "Sentinel Drop".
- **Axis 2 (Tech & innovation):** a digital twin fed by encrypted real telemetry reads as genuinely advanced.

## Build notes

- Keep the 3D scene decoupled from data: a small state store (sensor/event feed via WebSocket) → scene subscribes and reacts. Mock the feed so the twin can be built before hardware is ready.
- Low-poly stylized box model (exportable from the Fusion360 CAD used for the physical box) keeps it performant and on-brand.
- Everything reacts to the **same event stream** the real box emits — no fake data path in the final demo.
