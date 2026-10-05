# backend/ — API (REST + WebSocket)

**Node:** Command Post (Pi 5) · **Suggested:** Node.js (TypeScript) — cohesive with the dashboard

The nervous system of the Command Post: ingests from two paths, persists history, computes `Status`, pushes real-time events to the dashboard / Digital Twin — and enforces authentication on every channel.

## Responsibilities
- **Two ingress paths, one pipeline:**
  - Subscribe to **Mosquitto** (`sentinel/<id>/telemetry`, `sentinel/<id>/alert`) over MQTTS, as the `api` MQTT user.
  - Expose **`POST /api/v1/alerts`** (mandatory entry point) — for the `vision` and `predictive` services, on the internal Docker network only.
- Normalize both into the unified Alert pipeline → persist to the DB (telemetry + Alert history feeds the time-scrubber and the predictive model).
- **Recompute `Status`** (`nominal`/`elevated`/`critical`) after every Alert.
- **WebSocket** feed → live push to the dashboard (`telemetry`, `alert`, `status` frames).
- Relay Operator actuator commands: `POST /api/v1/commands` → MQTTS `command/<id>/actuator` → Sentinel.

## Security
Rules in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#security-model-binding-for-every-workstream).
- **Service tokens** on `POST /api/v1/alerts`: one per service, each restricted to its own `kind`; constant-time comparison.
- **Operator session** (`POST /api/v1/auth/login`, password hash in `.env`, cookie `HttpOnly; Secure; SameSite=Strict`) required on every other endpoint, on the WebSocket upgrade (+ `Origin` check) and behind `GET /api/v1/auth/check` (forward-auth for the camera feed).
- **Never trust the payload:** `sentinel` comes from the MQTT topic, `source` from the channel; strict schema validation, 16 KB body limit.
- **Rate limits:** login 5/min per IP, commands 2/s, alerts 20/s per token.

## Contract
Schemas, topics, endpoints, Status derivation: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement). Lock Monday with firmware (Sentinel) and AI.

## TODO
- [ ] `POST /api/v1/alerts` + token auth + schema validation
- [ ] MQTT subscriber → normalizer → DB writer
- [ ] Status engine
- [ ] Operator login + session middleware + `GET /api/v1/auth/check`
- [ ] WebSocket event bus (session-checked)
- [ ] `POST /api/v1/commands` → MQTT publish
- [ ] Rate limiting
- [ ] `.env.example` (broker URL, DB URL, token/password placeholders — no secrets committed)
