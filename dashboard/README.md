# dashboard/ — Web UI & 3D Digital Twin

**Node:** served by the Command Post (Pi) through the reverse proxy (HTTPS/WSS), rendered in the Operator's browser · **Suggested:** React + react-three-fiber (Three.js)

The face of Sentinel-X and our **"wow" centerpiece**. See [`../docs/DIGITAL-TWIN.md`](../docs/DIGITAL-TWIN.md).

## Must have (from the brief)
- Real-time environmental curves.
- Logical box status.
- Live camera feed — the annotated MJPEG stream served by the `vision` service.
- Reactive control panel to trigger actuators (buzzer, speaker, LEDs) remotely — `POST /api/v1/commands`.

## Security
- **Operator login** screen; every view, the WebSocket (`wss://`) and the camera feed sit behind the session.
- No token or secret in the front-end bundle.

## Our extra — the Digital Twin
- Live 3D replica of the **Outpost** reacting to the real WebSocket event stream.
- **Intruder marker** placed along the perimeter from the `intrusion` Alert's `x_norm`.
- **Component pulse** on a `predictive` anomaly; box flashes on `tamper`.
- **`Status`** drives the twin's overall color (`nominal`/`elevated`/`critical`).
- **Time-scrubber** replays a past Incident (grouped by `alert_id`) — demo insurance.
- Scenario mode for the 3-min live demo + 60s teaser.

## Build strategy
- Decouple scene from data: WebSocket feed → state store → scene subscribes.
- Mock the feed first so the twin progresses before hardware is ready.
- Low-poly Outpost assets (Kenney / Poly Pizza) + box model exported from the Fusion360 CAD.

## TODO
- [ ] App shell + Operator login + WebSocket client
- [ ] Charts + Status + camera panels
- [ ] 3D Outpost scene + data bindings
- [ ] Intruder placement (`x_norm` → perimeter arc)
- [ ] Actuator control panel
- [ ] Time-scrubber + scenario mode
