# dashboard/ — Web UI & 3D Digital Twin

**Owner:** Dev 3 · **Suggested:** React + react-three-fiber (Three.js)

The face of Sentinel-X and our **"wow" centerpiece**. See [`../docs/DIGITAL-TWIN.md`](../docs/DIGITAL-TWIN.md).

## Must have (from the brief)
- Real-time environmental curves.
- Logical box status.
- Live USB webcam feed.
- Reactive control panel to trigger actuators (buzzer, LEDs) remotely.

## Our extra — the Digital Twin
- Live 3D replica of the outpost reacting to the real event stream.
- Intruder marker on webcam detection, component pulse on predictive anomaly.
- **Time-scrubber** to replay the last incident (demo insurance).
- Scenario mode for the 3-minute live demo + 60s teaser.

## Build strategy
- Decouple scene from data: WebSocket feed → state store → scene subscribes.
- Mock the feed first so the twin progresses before hardware is ready.
- Low-poly box model exported from the Fusion360 CAD.

## TODO
- [ ] App shell + WebSocket client
- [ ] Charts + status + webcam panels
- [ ] 3D scene + data bindings
- [ ] Actuator control panel
- [ ] Time-scrubber + scenario mode
