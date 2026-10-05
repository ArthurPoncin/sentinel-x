# backend/ — API (REST + WebSocket)

**Node:** Command Post (Pi 4) · **Suggested:** Node.js (TypeScript) — cohesive with the dashboard

The nervous system of the Command Post: ingests from two paths, persists history, computes `Status`, and pushes real-time events to the dashboard / Digital Twin.

## Responsibilities
- **Two ingress paths, one pipeline:**
  - Subscribe to **Mosquitto** (`sentinel/<id>/telemetry`, `sentinel/<id>/alert`) — from the Sentinel over MQTTS.
  - Expose **`POST /api/v1/alerts`** (mandatory entry point) — from the AI Worker over HTTPS.
- Normalize both into the unified Alert pipeline → persist to the time-series DB (telemetry + Alert history feeds the time-scrubber).
- **Recompute `Status`** (`nominal`/`elevated`/`critical`) after every Alert.
- **WebSocket** feed → live push to the dashboard (`telemetry`, `alert`, `status` frames).
- Relay operator actuator commands → MQTTS `command/<id>/actuator` → Sentinel.

## Contract
Schemas, topics, Status derivation: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement). Lock Monday with firmware (Sentinel) and AI (Worker).

## TODO
- [ ] `POST /api/v1/alerts` + validation
- [ ] MQTT subscriber → normalizer → DB writer
- [ ] Status engine
- [ ] WebSocket event bus
- [ ] Actuator command endpoint → MQTT publish
- [ ] `.env.example` (broker URL, DB URL — no secrets committed)
