# backend/ — API (REST + WebSocket)

**Owner:** Dev 3 · **Suggested:** Node.js (TypeScript) — cohesive with the dashboard

Central nervous system of the Local Server: ingests MQTT telemetry, persists history, and pushes real-time events to the dashboard / Digital Twin.

## Responsibilities
- **Mandatory entry point:** `POST /api/v1/alerts` — receives sensor state changes.
- Subscribe to Mosquitto topics, normalize, persist to the time-series DB.
- **WebSocket** feed → live push to the dashboard (drives the twin).
- Relay operator actuator commands back to the ESP8266 via MQTT.

## Contract
See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#api-contract-mandatory-entry-point). Lock the payload schema Monday with Dev 1 (firmware) and Dev 2 (AI).

## TODO
- [ ] `POST /api/v1/alerts` + validation
- [ ] MQTT subscriber → DB writer
- [ ] WebSocket event bus
- [ ] Actuator command endpoint → MQTT publish
- [ ] `.env.example` (broker URL, DB URL — no secrets committed)
