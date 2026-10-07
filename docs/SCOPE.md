# Scope & Demo Scenario

What "done" means. The brief (PDF) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) say *how* the system is built; this file says *what we must show* and *in what order we build it*. It is the acceptance backbone for the GitHub issues.

---

## 1. The live demo (the acceptance target)

Local defense = 5 min: **minute 1** intro, **minute 2** teaser projection (60s), **minutes 3–5** live demo, then pitch + Q&A. The 3-minute live run below is scripted beat-by-beat so every graded axis is hit. Target ~2:40 with a 20s buffer. **Everything is real and live** (one labelled replay excepted).

| # | Beat (~time) | Action on the table | What the jury sees | Proves |
|---|---|---|---|---|
| 0 | 0:00 | Outpost nominal | Twin green, charts flat, camera clear, `Status: nominal` | Baseline, stable flux |
| 1 | 0:00–0:40 | Gas near the air probe (unlit lighter) | ESP32 raises `gas` warning→critical, **siren fires locally**, Twin box glows red, charts spike, `Status: critical` | Autonomous Alarm + telemetry → Twin |
| 2 | 0:40–1:20 | Someone steps into the camera view and moves | `vision` service → `intrusion` Alert; **intruder marker appears on the Twin perimeter and tracks their position** | Live vision, USB webcam (Pi) → `vision` → API → Twin |
| 3 | 1:20–1:50 | Loud clap next to the Sentinel | ESP32 raises `noise`; sound curve spikes, Twin ripples around the box | Multi-modal sensing (sound) |
| 4 | 1:50–2:20 | Operator opens the **time-scrubber**, replays Tuesday's recorded Incident (**labelled REPLAY**) | The slow temp+air drift the model flagged *before* the critical threshold | Predictive intelligence (not a static threshold) |
| 5 | 2:20–2:40 | Operator silences/tests the Alarm from the dashboard | Command → MQTTS → ESP32 reacts physically | Reactive control, full round-trip |
| — | 2:40 | Return to nominal | Twin green again | Clean close |

> **Demo insurance:** the time-scrubber (beat 4) can re-run beats 1–3 from recorded history if the live network hiccups. Nothing is faked (no injected fake readings) — a replay is clearly labelled as such.

---

## 2. The teaser "Sentinel Drop" (60s, 9:16, green-screen)

Beat sheet mapped to our product, following the brief's required structure:

| Window | Content |
|---|---|
| **00–10s · Hook** | The AetherCorp threat: remote plant, alert ambiance, siren. Grab attention. |
| **10–30s · Product (B-roll)** | Close-ups of the finished Sentinel: 3D-printed shell, laser engraving, the status screen, the probes. |
| **30–50s · The stack (incrustation)** | Team in front, behind them: animated architecture, real firmware C++ / Docker API, the vision model isolating an intruder, the 3D Twin reacting. Vulgarize the embedded intelligence. |
| **50–60s · Call to action** | Team to camera: *"Sentinel-X — security at the edge."* |

Deliverable: native vertical MP4, H.264.

---

## 3. Build tiers (priority order — guard against over-scope in 4 days)

### Tier 0 — Tracer bullet *(target: end of Tuesday)*
The smallest end-to-end slice that proves the spine. **If only this works, the "interconnection is pass/fail" rule is met.**
- One probe (e.g. `air`) on the ESP32 → telemetry over **MQTTS** → Mosquitto on the Pi.
- API ingests it → DB → **WebSocket** → the 3D Twin changes (box color) + `Status`.
- One live charts panel.

### Tier 1 — MVP *(all mandatory brief requirements)*
- **Firmware:** all core probes (DHT, air, PIR, sound), telemetry snapshots, **own threshold Alerts with hysteresis**, **autonomous Alarm** (siren on a DFPlayer + speaker). The status screen is the Pi's HDMI screen.
- **AI:** vision person detection on the USB webcam (≤640×480, <100ms; base `automaticdai/rpi-object-detection`) → `intrusion` Alert; predictive model (Isolation Forest on temp+air, **non-static**) → `predictive` Alert.
- **Backend:** two-path ingress (MQTTS + `POST /api/v1/alerts`), Status engine, WebSocket, actuator command relay.
- **Dashboard:** 3D Twin reacting to telemetry + Alerts, live charts, `Status`, camera feed, **reactive actuator control panel**.
- **Infra:** Docker-Compose stack on the Pi, isolated Wi-Fi/Ethernet 3-node network + IP plan, MCO monitoring.
- **Cyber:** MQTTS/TLS + HTTPS enforced, Pi hardening, pentest plan.

### Tier 2 — Wow / stretch *(in this order, as time allows)*
1. **Time-scrubber** replay (demo insurance + beat 4).
2. **Intruder `x_norm` positioning** on the perimeter (vs. a simple zone that lights up).
3. Scenario mode (one-button scripted demo sequence).

> Parked entirely (not tied to the three threats): UV, light, color, soil moisture, pulse, line-follow, rain, ultrasonic. Dropped (neither in the brief nor in our kit): accelerometer / tamper, fingerprint, joystick, MP3 speaker.

---

## 4. Non-code deliverables (Thursday evening)

| Deliverable | Format | Owner |
|---|---|---|
| Engineering report (network + wiring schema, security matrix, AI docs, pentest audit, A3 poster) | `...-Dossier.pdf` | TBD |
| Presentation: [`soutenance/`](soutenance/README.md), slides in one HTML page, timed on the 10 minutes | `...-Pres.pptx` (the page printed to PDF) | TBD |
| Teaser | `...-VidDrop.mp4` | TBD |
| Code archive | zip of this repo (no plaintext secrets) | TBD |
| Physical prototype | assembled, demo-ready | TBD |

Ownership of deliverables and workstreams (Q1) is settled by the team; issues are grabbable regardless.
