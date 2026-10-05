# The Digital Twin — our "wow"

A **live 3D replica** of the Sentinel-X outpost rendered in the dashboard (Three.js / react-three-fiber). Real data from every pillar drives the scene in real time. This is what makes the embedded intelligence *visible* to the jury.

## What maps to what

| Real signal | Source pillar | Twin reaction |
|---|---|---|
| Temperature / humidity (DHT22) | Edge | Heat shimmer / color grade on the box; thermal gauge |
| Gas / smoke (MQ-2) | Edge | Box glows red, particle haze intensity scales with ppm |
| Presence (PIR) | Edge | Perimeter zone flashes amber |
| Webcam intrusion (YOLO) | AI | Animated **intruder marker** appears at detected position in the 3D perimeter |
| Predictive anomaly (Isolation Forest) | AI | The drifting **component pulses orange** *before* the critical threshold |
| Actuator state (buzzer/LED/OLED) | Edge | Twin mirrors the physical box state (LED color, buzzer ring) |
| Secure link health (MQTTS) | Cyber/Infra | Connection "nerve" line green (encrypted) / red (down) |

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
