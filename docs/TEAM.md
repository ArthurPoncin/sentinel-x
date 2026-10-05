# Consortium & workstreams

5 people: **3 dev + 2 infra**. The **who-does-what split is still open** (decided together once we've brainstormed). What's stable is the set of workstreams and which node each runs on.

## Workstreams

### Edge / IoT — `firmware/` (Sentinel, ESP32)
- ESP32 firmware in C++ (PlatformIO).
- Probes: DHT (temp/humidity), air (gas), PIR (presence), accelerometer (tamper), fingerprint (access).
- Local LCD status, Alarm (buzzer + MP3 speaker + LEDs).
- Owns its threshold/tamper Alerts (with hysteresis) + autonomous Alarm; publishes telemetry + Alerts over MQTTS.

### AI / Data — `ai/` (AI Worker, laptop)
- **Vision:** intrusion detection on the Pi's camera stream (YOLOv8-tiny or OpenCV), ≤640x480, <100ms/frame → `intrusion` Alert with `x_norm`.
- **Predictive:** Isolation Forest on temp+air drift (+ velocity features). **No static `if temp>40`.** → `predictive` Alert.
- Posts Alerts to `POST /api/v1/alerts`.

### Dashboard / Digital Twin + API — `dashboard/` + `backend/` (Command Post, Pi)
- The **3D Digital Twin** (Three.js) — centerpiece.
- Real-time charts, `Status`, camera feed, reactive actuator control.
- REST + WebSocket API (`POST /api/v1/alerts`), Status engine, Alert history.

### Platform & Network — `infra/` (Command Post, Pi)
- Docker-Compose stack: Mosquitto, DB, API, dashboard, reverse proxy.
- Isolated 3-node network: Pi as Wi-Fi AP + `192.168.X.0/24`, Ethernet link to the Worker.

### Cyber & MCO — `cyber/` (transversal)
- MQTTS/TLS + HTTPS, Pi hardening, AI Worker hygiene, cross-team pentest + audit.
- MCO monitoring: Pi CPU/RAM, MQTT log volumes.

## Integration pacts (the pass/fail glue)

1. **Alert + telemetry contract** (firmware ↔ backend ↔ AI) — lock Monday. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement).
2. **Alert ownership map** — who computes which `kind` (settled, in ARCHITECTURE).
3. **MQTTS certs & topics** (Infra ↔ Cyber ↔ firmware) — lock Tuesday.
4. **Twin event feed** — the twin subscribes to the real WebSocket stream, nothing faked.

## Ways of working
- One GitHub Issue per user story; branch per issue; PR + review before merge to `main`.
- Semantic, regular commits (graded on Git rigor).
- `main` always demo-able.
