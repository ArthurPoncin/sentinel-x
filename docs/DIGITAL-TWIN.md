# The Digital Twin — our "wow"

A **live 3D replica** of the Sentinel-X outpost rendered in the dashboard (Three.js / react-three-fiber). Real data from every pillar drives the scene in real time. This is what makes the embedded intelligence *visible* to the jury.

## What maps to what

| Real signal (Alert `kind` / telemetry) | Source node | Twin reaction |
|---|---|---|
| Temperature (DHT) | Sentinel | The generator hall's roof glows red as `temp` rises; the air above it ripples while a `thermal` Alert is active |
| Gas (`air`) | Sentinel | Box glows red, a haze around the gas pipe thickens with the reading |
| Presence (`pir`) | Sentinel | The Enclosure's PIR dome blinks, an amber sweep goes round the fence |
| Noise (`noise`) | Sentinel | A wave of light leaves the box and spreads over the socle on each clap, scaled to the Alert's `value` (share of the cycle that was loud) |
| Intrusion (vision) | Command Post (`vision`) | The camera's field, a translucent volume from the Enclosure's lens down to its sector on the ground, lights up and the **intruder**, a human figurine in hologram, stands on the perimeter arc where `x_norm` places it, facing the lens that sees it. As `x_norm` changes it walks there, arms and legs in opposition, turned the way it goes, and faces the lens again once it has stopped. Four detection brackets frame it, facing the Twin's camera, and a label reads what the model sees and its `confidence`: « PERSONNE · 88 % ». Once the Alert is cleared the figurine goes out and leaves its hollow outline where it last stood, still, with no bracket, label or line to the lens, for about 5 s: the **last known position** |
| Predictive drift | Command Post (`predictive`) | The drifting **component pulses orange** *before* the critical threshold |
| `Status` (nominal/elevated/critical) | Command Post | When it rises, the whole scene is flooded in its color for 2 s, then the light goes back to neutral so the signals stand out. The rim light, the ring around the socle, the box's LCD and LED ring stay in its color |
| Alarm (buzzer) | Sentinel | LED ring blinks and buzzer sounds while a `gas` or `thermal` Alert is active. The contract does not carry the Alarm's own state: the Twin does not show it silenced by the Operator |

## Signature features

- **Time-scrubber** — replay a past Incident second-by-second, labelled REPLAY. Lets us script the live demo precisely and re-run it if the network hiccups. Built in #15: see [`../dashboard/README.md`](../dashboard/README.md#time-scrubber--featuresreplay).
- **Director's camera** — the Twin's camera orbits the site, and turns by itself to where an Alert happens the moment it is raised: the intruder on an intrusion, the gas pipe on a gas Alert, the generator hall on a thermal one, the gate on a presence, the box on a predictive drift. It gets there in 2 s by the shortest way round, stays about 6 s, then orbits again; a clap moves nothing. The Operator's hand always wins, and the camera does the same in a replay, in scenario mode and in capture mode. Built in #97: see [`../dashboard/README.md`](../dashboard/README.md#digital-twin--featurestwin).
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
