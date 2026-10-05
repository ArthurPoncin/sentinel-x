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

## Run it
Node ≥ 22.

```bash
npm install
MOCK_FEED=true npm run dev   # live feed on ws://127.0.0.1:8080/ws, no hardware needed
npm test
```

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address (`0.0.0.0` to serve other machines) |
| `PORT` | `8080` | Listen port |
| `MOCK_FEED` | `false` | `true` plays a scripted gas leak in a loop: `nominal` → `elevated` → `critical` → `nominal` |
| `MOCK_FEED_INTERVAL_MS` | `1000` | Delay between two mock telemetry snapshots |

## Live feed — `/ws`
Every connected client receives the same frames: `telemetry`, `alert` and `status`. On connect, a client first gets the current `Status`, then the latest telemetry snapshot if there is one — the UI never starts blank.

The schemas (zod) and their TypeScript types live in [`src/contract.ts`](src/contract.ts). Front-ends import them instead of redeclaring them — add `"@sentinel-x/backend": "file:../backend"` to the front-end's dependencies and run `npm run build` here:

```ts
import { FrameSchema, type Frame } from '@sentinel-x/backend/contract'

socket.onmessage = (event) => {
  const frame: Frame = FrameSchema.parse(JSON.parse(event.data))
}
```

## Alert ingress — `POST /api/v1/alerts`
The entry point of the `vision` and `predictive` services. The body is one Alert, as specified in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts):

```bash
curl -i -X POST http://127.0.0.1:8080/api/v1/alerts -H 'content-type: application/json' -d '{
  "alert_id": "intruder-1", "sentinel": "sentinel-01", "source": "vision",
  "kind": "intrusion", "severity": "critical", "state": "raised",
  "detail": { "x_norm": 0.42, "confidence": 0.88, "bbox": [120, 80, 60, 180] },
  "ts": "2026-10-05T14:23:05Z"
}'
```

| Response | When |
|---|---|
| `202` | Accepted: every client gets the `alert` frame, then the `status` frame it leads to |
| `400` | Not an Alert — the `message` names each offending field. Unknown fields are rejected, and `detail` must be the one of its `kind` (`{}` for `gas`, `thermal`, `presence`) |
| `403` | A service posting a `kind` it does not own: `vision` → `intrusion`, `predictive` → `predictive`. The Sentinel's kinds only come in over MQTT |
| `413` | Body above 16 KB |

A refused body is never broadcast and never moves the `Status`.

Post the same `alert_id` with `"state": "cleared"` to end the Alert. Posting `raised` again on an `alert_id` that is still raised updates that Alert (new `severity`, new `x_norm`…) instead of opening a second one. The `Status` is recomputed from the Alerts still raised and broadcast after every accepted Alert.

> No service token yet: the caller is the `source` it declares in the body. Once tokens are in, `source` comes from the token and the body's value is ignored.

## TODO
- [x] `POST /api/v1/alerts` + schema validation
- [ ] Service tokens on `POST /api/v1/alerts`
- [ ] MQTT subscriber → normalizer → DB writer
- [x] Status engine
- [ ] Operator login + session middleware + `GET /api/v1/auth/check`
- [x] WebSocket event bus
- [ ] Session + `Origin` check on the WebSocket upgrade
- [ ] `POST /api/v1/commands` → MQTT publish
- [ ] Rate limiting
- [ ] `.env.example` (broker URL, DB URL, token/password placeholders — no secrets committed)
