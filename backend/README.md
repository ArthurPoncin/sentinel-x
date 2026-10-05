# backend/ — API (REST + WebSocket)

**Node:** Command Post (Pi 4) · **Suggested:** Node.js (TypeScript) — cohesive with the dashboard

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
OPERATOR_AUTH=off MOCK_FEED=true HISTORY_FILE=:memory: npm run dev   # live feed on ws://127.0.0.1:8080/ws, no hardware, no login
npm test
```

All the configuration comes from environment variables. `npm run dev` and `npm start` also read them from `backend/.env` if there is one: copy [`.env.example`](.env.example) and fill it in. A variable set in the environment wins over the file. `.env` holds the broker password, the service tokens and the Operator's password hash: it is never committed. A value the API cannot make sense of stops it at start, naming the variable.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address (`0.0.0.0` to serve other machines; the image sets it) |
| `PORT` | `8080` | Listen port |
| `CORS_ORIGINS` | — | Origins allowed to call the API from a browser, comma-separated, e.g. `https://192.168.X.1,http://localhost:5173`. Unset: none — see [CORS](#cors) |
| `MOCK_FEED` | `false` | `true` plays the scripted scenario in a loop — see [Mock feed](#mock-feed) |
| `MOCK_FEED_INTERVAL_MS` | `1000` | Delay between two mock telemetry snapshots |
| `MQTT_URL` | — | Broker shared with the Sentinels, e.g. `mqtts://mosquitto:8883`. Unset: no telemetry in, no command out. Only `mqtts://` is accepted |
| `MQTT_USERNAME` | `api` | MQTT user |
| `MQTT_PASSWORD` | — | Its password. Required with `MQTT_URL`; never committed |
| `MQTT_CA_FILE` | — | Path of the team CA certificate (PEM). Required with `MQTT_URL` |
| `VISION_TOKEN` | — | Bearer token of the `vision` service on `POST /api/v1/alerts`, 32 characters or more. Unset: `vision` cannot post. Never committed |
| `PREDICTIVE_TOKEN` | — | Same for the `predictive` service; must differ from `VISION_TOKEN` |
| `OPERATOR_PASSWORD_HASH` | — | The Operator's password hash, from `npm run -s hash-password`. **Required** unless `OPERATOR_AUTH=off`. Never committed |
| `OPERATOR_AUTH` | `on` | `off` lets anyone in without logging in: development only |
| `HISTORY_FILE` | `data/history.sqlite` | SQLite file of the history, created with its directory if missing. `:memory:` keeps it in the process only |

## Docker
[`Dockerfile`](Dockerfile) builds the image the Compose stack runs as the `api` service. Nothing native to compile: it builds on the Pi (arm64) as on a laptop.

```bash
docker build -t sentinel-x/api backend/
docker run --env-file backend/.env -v api-data:/data sentinel-x/api
```

- The image sets `HOST=0.0.0.0`, `PORT=8080` and `HISTORY_FILE=/data/history.sqlite`: mount a volume on `/data` to keep the history across restarts.
- It runs as the unprivileged `node` user and publishes no port by itself: the reverse proxy reaches it as `api:8080` on the Compose network.
- No secret in the image: the broker password comes from the environment, the CA from a mounted file (`MQTT_CA_FILE`).
- Docker's healthcheck calls [`GET /health`](#health--get-health) every 15 s: the container is `unhealthy` while a broker is set and out of reach.
- `docker compose stop` sends SIGTERM: the API leaves the broker, closes the history file and exits right away.

## Health — `GET /health`
The service and its link to the broker, for Docker's healthcheck and the MCO monitoring. Outside `/api` on purpose: the reverse proxy routes only `/api` and `/ws`, so it stays on the internal network, and needs no Operator session.

```bash
curl -i http://127.0.0.1:8080/health
```

| Response | Body | When |
|---|---|---|
| `200` | `{ "status": "ok", "broker": "connected" }` | Connected to the broker |
| `200` | `{ "status": "ok", "broker": "off" }` | `MQTT_URL` unset: the API runs without a broker, as configured |
| `503` | `{ "status": "degraded", "broker": "disconnected" }` | A broker is set but out of reach, or refuses the login: no telemetry in, no command out. History and Incidents still answer |

The schema is in [`src/contract.ts`](src/contract.ts): `HealthSchema`.

## CORS
The dashboard and the Twin call their own origin: the reverse proxy on the Pi, the Vite proxy in dev. That needs no CORS, so by default the API allows no other origin.

A front-end served elsewhere — the Twin on its own port, the dashboard without the Vite proxy — is let in by adding its origin to `CORS_ORIGINS`: scheme, host and port, no path (`http://localhost:5173`, `https://192.168.X.1`). Only `GET` and `POST`, cookies allowed for the Operator session. `*` is refused.

CORS does not apply to the WebSocket: `/ws` checks the `Origin` itself — see [Operator session](#operator-session).

## Operator session
Every endpoint and the `/ws` feed need the Operator's session, except `GET /health`, the two below and `POST /api/v1/alerts` (service tokens). Without one: `401`, and the WebSocket upgrade is turned down.

```bash
npm run -s hash-password   # asks for the password (12 characters or more), prints OPERATOR_PASSWORD_HASH
curl -i -X POST https://192.168.X.1/api/v1/auth/login -H 'content-type: application/json' -d '{"password": "…"}'
```

| Endpoint | Answers |
|---|---|
| `POST /api/v1/auth/login` | `{ "password": "…" }` → `204` and the session cookie · `401` wrong password · `400` any other body |
| `GET /api/v1/auth/check` | `204` with a session, `401` without: forward-auth for the camera feed behind the reverse proxy, and the front's way to know whether to show its login screen |
| `POST /api/v1/auth/logout` | `204`: the session is closed and the cookie cleared |

- One Operator, one password, kept as an scrypt hash in `OPERATOR_PASSWORD_HASH`: the API never sees it in clear except at login. Without a hash, the API refuses to start.
- The cookie, `sx_session`, is `HttpOnly; Secure; SameSite=Strict`, for 12 hours. Sessions live in the API: a restart logs the Operator out.
- `/ws` also checks the `Origin` of the page opening it: the API's own origin as the browser reached it (`Host`, or `X-Forwarded-Host` from the reverse proxy) or one in `CORS_ORIGINS`; any other gets `403`, session or not. A client that is not a browser sends no `Origin` and only needs the session.
- `OPERATOR_AUTH=off` lets anyone in without logging in — every endpoint and `/ws` answer, `auth/check` says `204`. For development on a laptop only.

## Mock feed
`MOCK_FEED=true` plays a scripted scenario in a loop, one tick every `MOCK_FEED_INTERVAL_MS`, for the front-ends to work without a Sentinel, a broker or the AI services. Each tick is a telemetry snapshot, plus the Alerts the producers would send on it. They go through the same pipelines as the real ones: paired by `alert_id`, recorded in the history, broadcast, `Status` recomputed. Switching to the live feed changes nothing on the front.

One loop, 40 ticks (40 s by default), every kind of Alert in it:

| Ticks | What happens | `Status` |
|---|---|---|
| 0–5 | Calm: `air` ≈ 185, `temp` ≈ 31 °C, `sound` ≈ 0.03 | `nominal` |
| 6–9 | `predictive` flags the drift (`anomaly_score`, `drivers`) before any threshold | `elevated` |
| 10–14 | `gas` warning; someone walks past the PIR (`presence`) | `elevated` |
| 15–19 | `gas` critical, `air` up to 840, then `thermal` at 38.5 °C; `pir: true` | `critical` |
| 20–23 | `gas` back to warning, `thermal` cleared | `elevated` |
| 24–27 | `gas` and `predictive` cleared: the leak's Incident closes (10 Alerts) | `nominal` |
| 28–29 | A clap: `sound` 0.82, `noise` raised (`info`) then cleared | `nominal` |
| 32–36 | An `intrusion` crossing the camera's field, `x_norm` 0.15 → 0.75, then gone | `critical` → `nominal` |

- `alert_id`s are unique to each loop and each run (`mock-<run>-<loop>-<kind>`). The intruder keeps its `alert_id` while it moves: each new position is a `raised` that replaces the last.
- Every frame validates against the contract, like those of the real producers.

## Sentinel telemetry and Alerts — MQTTS
With `MQTT_URL` set, the API logs in to the broker over TLS, checks its certificate against the team CA and nothing else, and subscribes to `sentinel/+/telemetry` and `sentinel/+/alert`. Every snapshot a Sentinel publishes goes out as a `telemetry` frame on `/ws`. Every Alert goes through the same pipeline as those of `POST /api/v1/alerts`: paired by `alert_id`, recorded in the history, broadcast as an `alert` frame, then the `Status` it leads to.

```bash
MQTT_URL=mqtts://192.168.X.1:8883 MQTT_PASSWORD=… MQTT_CA_FILE=/path/to/team-ca.crt npm run dev
```

- The payload is the Telemetry snapshot of [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#telemetry-reading-snapshot--sentinelidtelemetry), validated strictly: every Reading present, no unknown field, `ts` in ISO 8601 UTC.
- An Alert is the Alert of [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts), validated just as strictly. Only the kinds the Sentinel decides come in this way: `gas`, `thermal`, `presence`, `noise`. An `intrusion` or `predictive` published there is dropped.
- `sentinel` is taken from the topic, and an Alert's `source` is always `esp32`. Whatever the payload says there is overwritten, and both may be left out.
- A payload that does not pass is dropped and logged with the reason (`MQTT: dropped a message on sentinel/sentinel-01/telemetry: … → at readings.air`); the subscription carries on.
- The host in `MQTT_URL` must be one the broker certificate names (`IP:192.168.X.1` from the table network, `DNS:mosquitto` inside Compose).
- The API starts even if the broker is down or refuses the login, and retries every second until it gets in. Same after a connection loss — no restart needed.

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
The entry point of the `vision` and `predictive` services. Each one sends its own token, `Authorization: Bearer <token>`, set in `VISION_TOKEN` / `PREDICTIVE_TOKEN`. The body is one Alert, as specified in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts):

```bash
curl -i -X POST http://127.0.0.1:8080/api/v1/alerts -H 'content-type: application/json' \
  -H "authorization: Bearer $VISION_TOKEN" -d '{
  "alert_id": "intruder-1", "sentinel": "sentinel-01",
  "kind": "intrusion", "severity": "critical", "state": "raised",
  "detail": { "x_norm": 0.42, "confidence": 0.88, "bbox": [120, 80, 60, 180] },
  "ts": "2026-10-05T14:23:05Z"
}'
```

| Response | When |
|---|---|
| `202` | Accepted: every client gets the `alert` frame, then the `status` frame it leads to |
| `400` | Not an Alert — the `message` names each offending field. Unknown fields are rejected, and `detail` must be the one of its `kind` (`{}` for `gas`, `thermal`, `presence`, `noise`) |
| `401` | No bearer token, or one no service holds — answered before the body is read, with `WWW-Authenticate: Bearer` |
| `403` | A service posting a `kind` it does not own: `vision` → `intrusion`, `predictive` → `predictive`. The Sentinel's kinds only come in over MQTT |
| `413` | Body above 16 KB |

A refused body is never broadcast and never moves the `Status`.

Post the same `alert_id` with `"state": "cleared"` to end the Alert. Posting `raised` again on an `alert_id` that is still raised updates that Alert (new `severity`, new `x_norm`…) instead of opening a second one. The `Status` is recomputed from the Alerts still raised and broadcast after every accepted Alert.

- `source` comes from the token: whatever the body says there is overwritten, and it may be left out.
- Tokens are compared in constant time. Each must be at least 32 characters (`openssl rand -hex 32`), and the two must differ. A service with no token set cannot post: the API starts all the same.

## History — `GET /api/v1/history`
Feeds the time-scrubber. Every telemetry snapshot that comes in over MQTTS and every Alert the API accepts is written to an SQLite file (`HISTORY_FILE`) before it goes out on `/ws`. So is the [mock feed](#mock-feed), which goes through the same pipelines: run it on `HISTORY_FILE=:memory:` or a file of its own to keep it out of the real history.

```bash
curl 'http://127.0.0.1:8080/api/v1/history?from=2026-10-05T14:20:00Z&to=2026-10-05T14:30:00Z'
```

| Query | Value |
|---|---|
| `from` | Start of the range, ISO 8601 UTC, included |
| `to` | End of the range, ISO 8601 UTC, included. Not before `from` |

```jsonc
{
  "records": [
    { "type": "telemetry", "payload": { /* telemetry snapshot */ } },
    { "type": "alert",     "payload": { /* alert object */ } }
  ]
}
```

| Response | When |
|---|---|
| `200` | The records whose `ts` falls in the range, oldest first — the same `telemetry` and `alert` frames as on `/ws`, so a replay can go through the same code as the live feed. Records sharing a `ts` keep the order they came in. A range where nothing happened gives `{ "records": [] }` |
| `400` | A bound missing, not ISO 8601, or `from` after `to` — the `message` names it |

- Dates are those of the payloads: the Sentinel's `ts` for telemetry and its Alerts, the service's for the others. Records are sorted by instant, so `…:00Z` and `…:00.500Z` come in the right order.
- Every cleared Alert is kept along with its raised one: `alert_id` pairs them, and the `Status` at any instant follows from the Alerts raised by then.
- The schemas are in [`src/contract.ts`](src/contract.ts): `HistorySchema`, `HistoryRecordSchema`, `HistoryQuerySchema`.
- If the file cannot take a record (SD card full…), the API logs it and the live feed carries on.
- The storage sits behind the `HistoryRepository` interface of [`src/history.ts`](src/history.ts) (`append`, `query(range)`): SQLite in production, in memory for the tests, both held to the same test suite.
- Node prints `ExperimentalWarning: SQLite is an experimental feature` once at start: the API uses Node's built-in `node:sqlite`, so nothing native to compile on the Pi.


## Incidents — `GET /api/v1/incidents`
What the time-scrubber offers to replay. An Incident opens on the first `raised` Alert and closes on the `cleared` that leaves no Alert raised. Incidents are built from the history on every request, never stored: whatever the history holds, the Incidents follow.

```bash
curl http://127.0.0.1:8080/api/v1/incidents
```

```jsonc
{
  "incidents": [
    {
      "incident_id": 1,
      "start": "2026-10-05T14:23:00Z",   // ts of the Alert that opened it
      "end": "2026-10-05T14:23:50Z",     // ts of the cleared that closed it, null while it goes on
      "ongoing": false,                  // true until every Alert is cleared
      "alerts": 8,                       // raised and cleared alike
      "kinds": ["gas", "presence"],      // in the order they first came
      "peak": "critical"                 // the highest severity it reached
    }
  ]
}
```

- Oldest first, numbered from 1 in the order they started. The numbers hold as long as no Alert comes in dated before the latest Incident.
- Alerts pair by `alert_id`, as for the `Status`: an Alert raised again on the same `alert_id` (warning → critical → warning) needs one `cleared`, and it stays one Alert to close. Alerts of every Sentinel and every source count.
- The reference scenario — gas nominal → warning → critical → warning → nominal, and the PIR detecting someone twice meanwhile — is 8 Alerts and 1 Incident.
- A `cleared` with no Incident going on opens nothing and closes nothing.
- Nothing ever raised gives `{ "incidents": [] }`.

## Replay — `GET /api/v1/incidents/:incident_id`
What the Twin replays of one Incident.

```bash
curl http://127.0.0.1:8080/api/v1/incidents/1
```

```jsonc
{
  "incident": { "incident_id": 1, "start": "…", "end": "…", "ongoing": false, /* as in the list */ },
  "records": [
    { "type": "alert",     "payload": { /* alert object */ } },
    { "type": "telemetry", "payload": { /* telemetry snapshot */ } }
  ]
}
```

| Response | When |
|---|---|
| `200` | The Incident, then its Alerts and the telemetry from its `start` to its `end`, both included, oldest first — the same frames, in the same order, as `GET /api/v1/history`. An Incident going on runs up to its latest record |
| `400` | `incident_id` is not a whole number from 1 |
| `404` | No Incident has this number |

- Only the Incident's own Alerts are in: when it opens on the instant the one before closed, or closes on the instant the next opens, their Alerts are left out. The telemetry of those instants stays in.
- The schemas are in [`src/contract.ts`](src/contract.ts): `IncidentsSchema`, `IncidentReplaySchema`, `IncidentSchema`.
- The mock feed makes three Incidents per loop, like a real Outpost would.


## Actuator commands — `POST /api/v1/commands`
The Operator's way to the Alarm. The API stamps the command with a `cmd_id` and a `ts`, then publishes it on `command/<sentinel>/actuator`, over the same MQTTS connection the telemetry comes in on.

```bash
curl -i -X POST http://127.0.0.1:8080/api/v1/commands -H 'content-type: application/json' -d '{
  "sentinel": "sentinel-01", "actuator": "led", "action": "pattern",
  "params": { "pattern": "siren", "led": "red" }
}'
```

The body is the Actuator command of [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#actuator-command--commandidactuator) without `cmd_id` and `ts`:

| Field | Value |
|---|---|
| `sentinel` | The Sentinel to reach. It becomes a level of the topic: letters, digits, `-` and `_` only, 64 at most |
| `actuator` | `buzzer` or `led` |
| `action` | `on`, `off` or `pattern` |
| `params` | Optional. `pattern` and `led`, each optional, 32 characters at most |

| Response | When |
|---|---|
| `202` | The broker has the command. The body is the command as published, `cmd_id` (a UUID) and `ts` included: the Sentinel reads that same JSON on its topic |
| `400` | Not a command — the `message` names each offending field. Unknown fields are rejected, `cmd_id` and `ts` among them |
| `413` | Body above 1 KB |
| `503` | No broker to relay to: `MQTT_URL` unset, broker away, or gone before it acknowledged |

- Published at QoS 1, not retained: the `202` waits for the broker's acknowledgement. The QoS the Sentinel subscribes with decides the last hop.
- A command is for now. One the broker did not take is refused and never sent later, even once the broker is back: the Operator sends it again.
- A refused command is never published.

> No rate limit yet: an Operator can send commands as fast as they like.

## TODO
- [x] `POST /api/v1/alerts` + schema validation
- [x] Service tokens on `POST /api/v1/alerts`
- [x] MQTT subscriber: Sentinel telemetry → WebSocket
- [x] MQTT subscriber: Sentinel Alerts → normalizer
- [x] DB writer (telemetry + Alert history)
- [x] `GET /api/v1/history` for the time-scrubber
- [x] Incidents: `GET /api/v1/incidents` and their replay
- [x] Status engine
- [x] Operator login + session middleware + `GET /api/v1/auth/check`
- [x] WebSocket event bus
- [x] Session + `Origin` check on the WebSocket upgrade
- [x] `POST /api/v1/commands` → MQTT publish
- [ ] Rate limiting
- [x] `.env.example` (broker URL, history file, CORS origins, password placeholder — no secrets committed)
- [x] CORS, `GET /health`, Dockerfile
