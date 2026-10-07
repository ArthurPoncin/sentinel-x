# Consortium & workstreams

5 people: **3 dev + 2 infra**. The **who-does-what split is still open** (decided together once we've brainstormed). What's stable is the set of workstreams and which node each runs on.

Architecture: the brief's **Option A** — everything server-side runs on the Command Post (Raspberry Pi 4 inside the Enclosure). See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Workstreams

### Edge / IoT — `firmware/` (Sentinel, ESP32)
- ESP32 firmware in C++ (PlatformIO).
- Probes: DHT22 (temp/humidity), MQ-2 (gas), PIR HC-SR501 (presence), CZN-15E sound sensor (noise).
- Alarm (a speaker driven through a transistor: the siren). The status display is the Pi's HDMI screen (infra).
- Owns its threshold Alerts (`gas`, `thermal`, `presence`, `noise`, with hysteresis) + autonomous Alarm; publishes telemetry + Alerts over MQTTS (CA-verified, own credentials).

### AI / Data — `ai/` (Command Post, Pi)
- **Vision:** person detection on the Pi's USB webcam, built on [`automaticdai/rpi-object-detection`](https://github.com/automaticdai/rpi-object-detection) (TFLite + Picamera2; OpenCV motion detection as fallback), ≤640x480, <100ms/frame → `intrusion` Alert with `x_norm`. **Benchmark on the Pi Monday** — it validates Option A.
- **Predictive:** Isolation Forest on live temp+air telemetry, subscribed over MQTTS (+ velocity features). **No static `if temp>40`.** → `predictive` Alert.
- Both run as containers on the Pi and post to `POST /api/v1/alerts` with their service token.

### Dashboard / Digital Twin + API — `dashboard/` + `backend/` (Command Post, Pi)
- The **3D Digital Twin** (Three.js) — centerpiece.
- Real-time charts, `Status`, camera feed, reactive actuator control, Operator login.
- REST + WebSocket API (`POST /api/v1/alerts`, `POST /api/v1/commands`), authentication, Status engine, Alert history.

### Platform & Network — `infra/` (Command Post, Pi)
- Docker-Compose stack: reverse proxy, Mosquitto, DB, API, dashboard, vision, predictive.
- Isolated table network: Pi as WPA2 Wi-Fi AP + `192.168.X.0/24` IP plan.

### Cyber — `cyber/` (transversal)
- MQTTS/TLS + HTTPS/WSS, team CA, MQTT credentials + ACL, API tokens.
- Pi + Docker hardening, Wi-Fi security, cross-team pentest + audit.

## Integration pacts (the pass/fail glue)

1. **Alert + telemetry contract** (firmware ↔ backend ↔ AI) — lock Monday. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement).
2. **Alert ownership map** — who computes which `kind` (settled, in ARCHITECTURE).
3. **Security material** — team CA + certs, MQTT credentials & ACL, API tokens (Infra ↔ Cyber ↔ firmware ↔ AI) — lock Tuesday. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#security-model-binding-for-every-workstream).
4. **Twin event feed** — the twin subscribes to the real WebSocket stream, nothing faked.

## Ways of working
- One GitHub Issue per user story; branch per issue; PR + review before merge to `main`.
- Semantic, regular commits (graded on Git rigor).
- `main` always demo-able.
