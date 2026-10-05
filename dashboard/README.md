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

npm test            # store, feed client, config, gas level, scene mapper, fades, automatic orbit, pixel ratio, framing
npm run build       # typecheck + production bundle in dist/
```

**Filming the Twin for the teaser** — open `/twin?capture` in a vertical 9:16 window (1080 × 1920) and record the screen while the scenario plays: the Twin alone on black, no interface, on the same feed. See [capture mode](#digital-twin--featurestwin).

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
│   ├── live-feed/           # #10 — the socket, the store, the hook
│   │   ├── api/             # connectFeed(): WebSocket client, backoff, drops bad frames
│   │   ├── stores/          # apply(state, event): pure reducer + tiny external store
│   │   ├── hooks/           # useLiveFeed(selector)
│   │   ├── components/      # LiveFeedProvider, ConnectionIndicator, FeedInspector
│   │   └── index.ts         # the feature's public API
│   └── twin/                # #20, #12, #30, #33, #40 — the 3D Outpost, on its studio stage
│       ├── components/      # OutpostTwin: the scene, drawn from SceneProps · OrbitCamera · Halo
│       ├── hooks/           # usePixelRatio(element) · useFade(target), useColorFade(color)
│       ├── utils/           # toScene(state): the scene's props, pure · gasLevel(air): 0–1
│       │                    # autoOrbitSpeed(touch, now) · pixelRatio(density, width, height)
│       │                    # wholeStageDistance(aspect) · fadeTo(fade, to, now), fadeValue(fade, now)
│       └── index.ts
└── shared/
    ├── contract/            # re-exports backend/src/contract.ts — never redeclare a schema
    └── config/              # feedUrl() · captureMode() · STATUS_COLORS
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
| `features/twin` (started) | #13 / #23 intrusion, pulse | `/twin` |
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
- `connection` is the socket as it is now (`connecting`, `open`, `closed`), `connectedOnce` whether it has ever been open. Together they tell a signal lost (not open any more) from a first connection still being tried.
- Types come from `@/shared/contract`: `Telemetry`, `Alert`, `Status`, `Frame`…
- The Status colors are defined once, in `shared/config/status-colors.ts` (`STATUS_COLORS`). `main.tsx` hands them to the stylesheet as `--nominal`, `--elevated` and `--critical`; the Twin lights its scene with the same.

## Digital Twin — `features/twin`

```tsx
import { OutpostTwin, toScene } from '@/features/twin'

const connection = useLiveFeed((state) => state.connection)
const connectedOnce = useLiveFeed((state) => state.connectedOnce)
const status = useLiveFeed((state) => state.status)
const latestTelemetry = useLiveFeed((state) => state.latestTelemetry)
const activeAlerts = useLiveFeed((state) => state.activeAlerts)
const scene = useMemo(
  () => toScene({ connection, connectedOnce, status, latestTelemetry, activeAlerts }),
  [connection, connectedOnce, status, latestTelemetry, activeAlerts],
)
<OutpostTwin scene={scene} />
```

- `toScene(state)` turns the live state into what the scene shows, and is all the scene reads: pure, tested without WebGL. It gives the Enclosure's color and glow (gas), what its LCD reads and the color its LED ring breathes in (the Status), the Status's color grade, the drivers to pulse (active `predictive` Alerts), where the intruder stands (last active `intrusion`'s `x_norm`) and whether the signal is lost. The pulse and the intruder are not drawn yet (#13).
- The `Status` grades the whole scene. At `nominal` the studio keeps its neutral light, and only the perimeter ring, the LCD and the LED ring are green. At `elevated` and `critical` every light takes the Status's color: the whole model is lit in amber, in red. It follows the Command Post's Status, never the readings. The sky stays black on the stage (#30): the grade's `background` is no longer drawn.
- **Nothing cuts** (#33). A new Status fades in over `FADE_SECONDS` (0.8 s), lights, perimeter ring, LCD and LED ring together, and one that comes during a fade starts from the color on screen. `fadeTo(fade, to, now)` and `fadeValue(fade, now)` are that rule, pure and tested; `useFade` / `useColorFade` run it on every frame.
- **Signal lost** (#33). When the feed closes after having been open, `scene.signalLost` is true until it is open again, the retries in between included: the whole frame fades to grey (`<Halo saturation>`), "Signal lost" shows over the scene and the caption loses its colors, so that a stale state never passes for a live one. Before the first connection there is no signal to lose: the scene is neutral, with no notice. To see it, stop the backend.
- The Enclosure goes from dark anodized to red as `readings.air` rises, and lights the ground around it. It follows the telemetry, not the Alerts: it moves before any `gas` Alert is raised.
- `gasLevel(air)` gives the share of the way from calm to critical, 0–1. Its two bounds, `CALM_AIR` (200) and `CRITICAL_AIR` (620), are those of the mock feed: tune them to the MQ-2's calibration when the Sentinel sends its own Readings.
- What follows the Readings (the Enclosure's gas color and glow) eases toward them (`EASE`): a snapshot a second flows into the next, it does not jump.
- The feature takes its data as props: `app/routes/twin.tsx` reads the feed, maps it with `toScene` and hands it over. `TwinState` asks for the live-feed state's fields by shape, so a replayed state (time-scrubber) feeds it the same way.

**The stage** (#30) is what every later Twin slice is set on:

- **Full screen** — `OutpostTwin` fills its parent. A route that renders a `.stage` gets the whole window under the top bar (`styles.css`); the other routes keep the padded page.
- **Light** — black background, a key light that casts the soft shadows, a cold rim light from behind, a trace of fill. The key and the fill take the grade's `light`, the rim its `rim`: neutral at `nominal`, the Status's color otherwise. The lights stay put while the camera orbits. Give a new mesh `castShadow` / `receiveShadow`.
- **Halo** — only what emits light glows. `Halo` draws the scene a second time with its lights off and blurs that image over the frame: set `emissive` + `emissiveIntensity` on a material and it glows in proportion, in its own color; a lit surface never does, however bright. An unlit material (`meshBasicMaterial`) counts as emitting — the perimeter ring glows in the Status's color that way — so use a standard one for anything that should not glow. Its pass is the last to touch the frame: that is also where the frame turns grey when the signal is lost (`saturation`).
- **Color** — the frame is rendered in HDR and tone-mapped with `NeutralToneMapping`, which leaves the Status colors as they are.
- **Camera** — it goes around the Outpost in 80 s. The Operator can turn it and zoom with the mouse, between bounds that keep the Outpost in frame (no panning, never under the ground); 3 s after they let go, the orbit picks up speed again. `autoOrbitSpeed` is that rule, as a pure function.
- **Resolution** — `pixelRatio` caps the rendering at a pixel ratio of 2 and at 3 million pixels (`MAX_PIXELS`), whatever the screen. That budget was measured on an Iris Xe, where the Twin holds 60 images per second up to about 3.4 million pixels: raise it on a stronger GPU.

**The Enclosure** (#31) — the Sentinel-X product itself, on a mast, at an exaggerated scale (`SCALE`) to stay readable from the back of the room. Built in code from bevelled volumes (`RoundedBoxGeometry`) and canvas-drawn textures, no external model.

![The Enclosure, nominal](../docs/twin/enclosure-nominal.png)

- **Front:** the LCD band, then the camera lens, the PIR dome, the mic grille. **Under the body:** the ventilated Probe compartment, louvres front and back, the DHT22 and the MQ-2 visible between them. **On top:** the buzzer and the LED ring around it. **Right side:** the engraving, *AetherCorp / SENTINEL-X / serial* (`ENGRAVING`).
- **Parts to drive:** every Probe and actuator is a named object — `scene.getObjectByName(ENCLOSURE_PARTS.mq2)` — for the later slices: predictive pulse on `dht22` / `mq2` (#13), PIR flash, alarm on `ledRing` / `buzzer`.
- **LCD:** shows `scene.enclosure.lcd.text` (`LCD_TEXT`: `NOMINAL`, `ELEVATED`, `CRITICAL`) in the Status's color. The text switches like a real LCD's, the color fades. Unlit, so it glows.
- **LED ring:** breathes in the Status's color, one breath every `BREATH_PERIOD` (4 s), never below `BREATH_FLOOR` — `breath(t)` is pure and tested. The kit has no LED any more (`docs/ARCHITECTURE.md`): on the Twin, the ring is the Status light.
- **Gas:** the body carries the glow of #20, and lights the ground from inside it.
- **Camera:** the orbit now turns around the Enclosure's height (`TARGET` y = 1.2).

**Capture mode** (#40) — `/twin?capture` is the Twin alone, to be filmed for the teaser:

- **No interface** — no top bar, no connection indicator, no caption: the canvas takes the whole window, on black. `captureMode(location)` reads the parameter (being there is enough, whatever its value); without it `/twin` is the normal view.
- **Same feed** — mock or live, it plays what the normal view plays.
- **Whole in frame** — `<OutpostTwin wholeStage />` stands the camera back until the whole stage holds in the frame, whatever its shape: `wholeStageDistance(aspect)` fits a sphere around the stage (`STAGE_RADIUS`, the perimeter ring plus room for its halo) in the narrower field of view, so it holds all the way around the orbit and at any tilt. The camera can still be turned by hand; it no longer zooms.
- Anything added to the stage further out than the perimeter ring needs a larger `STAGE_RADIUS`.

## TODO
- [x] App shell + live feed (WebSocket client, store, hook) — #10
- [ ] Operator login screen: the API is ready (`POST /api/v1/auth/login`, `GET /api/v1/auth/check`, see [`../backend/README.md`](../backend/README.md#operator-session))
- [ ] Charts + Status + Alerts — #21, #11
- [ ] Camera panel + actuator control panel — #14
- [x] 3D Outpost whose Enclosure reacts to gas — #20
- [x] Scene mapper + Status color — #12
- [x] Twin full screen, in studio light, with an orbiting camera — #30
- [x] The Enclosure, with its LCD and LED ring alive — #31
- [x] Status fades and "signal lost" — #33
- [x] Capture mode for the teaser (`/twin?capture`) — #40
- [ ] Intruder placement (`x_norm` → perimeter arc), pulse — #13, #23
- [ ] Time-scrubber + scenario mode — #15
- [ ] CI: build + smoke render — #16
