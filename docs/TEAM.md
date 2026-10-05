# Consortium & task split

5 people: **3 dev + 2 infra**. Cybersecurity is a full pillar mapped onto an infra member but stays transversal — everyone secures their own brick.

## Ownership

### Dev 1 — Edge / IoT (`firmware/`)
- ESP8266 firmware in C++ (PlatformIO).
- Cadenced reads: DHT22 (temp/humidity), MQ-2 (gas), PIR (presence).
- OLED I2C status screen, buzzer + status LEDs (reactive actuators).
- Structured telemetry payloads → published over MQTTS.
- **Owns the payload contract** jointly with the API.

### Dev 2 — AI / Data (`ai/`)
- Standalone Python running on the Local Server.
- **Vision:** webcam intrusion detection (YOLOv8-tiny or OpenCV shape detection), frames resized ≤640x480, <100ms/frame.
- **Predictive:** correlation-based anomaly detection on sensor time-series (Isolation Forest / Random Forest). **No static `if temp>40` rules.**
- Publishes events/scores to the API.

### Dev 3 — Dashboard / Digital Twin + API (`dashboard/` + `backend/`)
- The **3D Digital Twin** (Three.js / react-three-fiber) — our centerpiece.
- Real-time charts, box status, live webcam feed, reactive actuator control panel.
- REST + WebSocket API (`POST /api/v1/alerts`), event history.

### Infra 1 — Platform & Network (`infra/`)
- Docker-Compose stack: Mosquitto, DB, API, (AI), dashboard, reverse proxy.
- Isolated Wi-Fi AP + `192.168.X.0/24` IP plan, masks, routing, table isolation.

### Infra 2 — Cyber & MCO (`cyber/`)
- End-to-end encryption: MQTTS/TLS, HTTPS.
- Hardening: close unused ports (UFW/iptables), SSH keys only (no passwords), strict Docker daemon privileges.
- Cross-team pentest (Thursday) + audit report.
- MCO monitoring: CPU/RAM, MQTT log volumes.

## Integration pacts (the pass/fail glue)

1. **Payload contract** (Dev 1 ↔ Dev 3) — lock Monday.
2. **Event schema** AI → API (Dev 2 ↔ Dev 3) — lock Monday.
3. **MQTTS certs & topics** (Infra 1 ↔ Infra 2 ↔ Dev 1) — lock Tuesday.
4. **Twin event feed** (Dev 3 ↔ everyone) — the twin subscribes to the real event stream.

## Ways of working

- One GitHub Issue per user story; branch per issue; PR + review before merge to `main`.
- Semantic, regular commits (graded on Git rigor).
- `main` always demo-able. Integration branch if needed before Wednesday.
