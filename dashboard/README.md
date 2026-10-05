# dashboard/ — Web UI & 3D Digital Twin

**Node:** served by the Command Post (Pi) through the reverse proxy (HTTPS/WSS), rendered in the Operator's browser · **Stack:** Vite + React + TypeScript, react-three-fiber (Three.js) for the Twin

The face of Sentinel-X and our **"wow" centerpiece**. See [`../docs/DIGITAL-TWIN.md`](../docs/DIGITAL-TWIN.md).

**One app, two screens on the same live feed:** `/` is the Operator's dashboard, `/twin` the Digital Twin (lazy-loaded, so three.js only loads there). For the demo, open each in its own window. One origin, one container, one Operator session, as in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Must have (from the brief)
- Real-time environmental curves.
- Logical box status.
- Live camera feed — the annotated MJPEG stream served by the `vision` service.
- Reactive control panel to trigger the actuator (buzzer) remotely — `POST /api/v1/commands`.

## Security
- **Operator login** screen; every view, the WebSocket (`wss://`) and the camera feed sit behind the session.
- No token or secret in the front-end bundle.

## Our extra — the Digital Twin
- Live 3D replica of the **Outpost** reacting to the real WebSocket event stream.
- **Intruder marker** placed along the perimeter from the `intrusion` Alert's `x_norm`.
- **Component pulse** on a `predictive` anomaly; sound ripples on `noise`.
- **`Status`** drives the twin's overall color (`nominal`/`elevated`/`critical`).
- **Time-scrubber** replays a past Incident (grouped by `alert_id`) — demo insurance.
- Scenario mode for the 3-min live demo + 60s teaser.

## Run it
Node ≥ 22. Start the mock feed first, then the app:

```bash
# terminal 1 — the Command Post API playing its scripted scenario (gas leak, clap, intruder)
cd backend && npm install && OPERATOR_AUTH=off MOCK_FEED=true HISTORY_FILE=:memory: npm run dev

# terminal 2 — the app on http://localhost:5173 (/ and /twin)
cd dashboard && npm install && npm run dev

npm test            # store, feed client, config
npm run build       # typecheck + production bundle in dist/
```

The app always talks to its **own origin** (`/ws`, `/api`): the Vite dev server proxies them to `BACKEND_URL`, the reverse proxy does it on the Pi. Mock or live is the backend's setting, the front never changes.

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND_URL` | `http://127.0.0.1:8080` | Command Post API that `/ws` and `/api` are proxied to in `dev` and `preview` (e.g. the Pi's address). Set it in `.env` (see `.env.example`). |

## Structure — feature-driven

```
src/
├── main.tsx
├── app/                     # composition only: shell, router, routes
│   ├── app.tsx              # LiveFeedProvider + router
│   ├── router.tsx           # /  and  /twin (lazy)
│   ├── layout.tsx
│   └── routes/              # operator.tsx, twin.tsx — assemble features, no logic
├── features/
│   └── live-feed/           # #10 — the socket, the store, the hook
│       ├── api/             # connectFeed(): WebSocket client, backoff, drops bad frames
│       ├── stores/          # apply(state, event): pure reducer + tiny external store
│       ├── hooks/           # useLiveFeed(selector)
│       ├── components/      # LiveFeedProvider, ConnectionIndicator, FeedInspector
│       └── index.ts         # the feature's public API
└── shared/
    ├── contract/            # re-exports backend/src/contract.ts — never redeclare a schema
    └── config/              # feedUrl()
```

**Rules**
- A feature owns everything it needs (`api/`, `stores/`, `hooks/`, `components/`, `utils/`… only the folders it uses).
- Import a feature through its `index.ts` only (`@/features/live-feed`), never its folders.
- Features don't import each other; `app/routes` composes them. `shared/` imports nothing from `features/` or `app/`.
- Logic goes in pure functions next to their tests (`*.test.ts`), so it is tested without a browser; components stay thin.
- Imports use the `@/` alias for `src/`.

**Features to come**

| Feature folder | Tickets | On |
|---|---|---|
| `features/telemetry` | #21 gas curve, #11 every curve | `/` |
| `features/status` · `features/alerts` | #11 Status badge, active Alerts | `/` |
| `features/camera` · `features/actuators` | #14 camera feed, actuator panel | `/` |
| `features/twin` | #20 3D Outpost, #12 scene mapper, #13 / #23 intrusion, pulse | `/twin` |
| `features/replay` | #15 time-scrubber, scenario mode (rebuilds state with `apply`) | `/twin` |

## Live feed — `features/live-feed`

```tsx
import { useLiveFeed } from '@/features/live-feed'

const status = useLiveFeed((state) => state.status)                  // 'nominal' | 'elevated' | 'critical'
const telemetry = useLiveFeed((state) => state.latestTelemetry)      // last snapshot, or null
const alerts = useLiveFeed((state) => state.activeAlerts)            // raised, not cleared yet
const history = useLiveFeed((state) => state.history)                // every frame, oldest first (last 1000)
```

- Select a state field as is; derive anything else with `useMemo` (a selector returning a new array each call loops).
- The Status comes from the Command Post: the front never recomputes it.
- On every (re)connection the backend sends its snapshot (current Status + latest telemetry) and the active Alerts start over, since some may have cleared while the socket was down.
- Types come from `@/shared/contract`: `Telemetry`, `Alert`, `Status`, `Frame`…

## TODO
- [x] App shell + live feed (WebSocket client, store, hook) — #10
- [ ] Operator login screen: the API is ready (`POST /api/v1/auth/login`, `GET /api/v1/auth/check`, see [`../backend/README.md`](../backend/README.md#operator-session))
- [ ] Charts + Status + Alerts — #21, #11
- [ ] Camera panel + actuator control panel — #14
- [ ] 3D Outpost scene + data bindings — #20, #12
- [ ] Intruder placement (`x_norm` → perimeter arc), pulse — #13, #23
- [ ] Time-scrubber + scenario mode — #15
- [ ] CI: build + smoke render — #16
