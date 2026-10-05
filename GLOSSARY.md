# Sentinel-X

Autonomous cyber-physical surveillance system for AetherCorp's remote micro–power plants. This glossary is the shared language for the whole consortium — use these terms everywhere (code, docs, commits, pitch).

## Language

### Physical entities

**Outpost**:
A protected site — one micro–power plant and its perimeter. The thing the Digital Twin is a model of.
_Avoid_: site, plant, station.

**Sentinel**:
The physical box in the field: an **ESP32** with the environmental and intrusion probes, a local display, and the Alarm hardware (buzzer + speaker), inside the 3D-printed shell. Carries the probes, not the camera.
_Avoid_: box, edge node, device, module.

**Sentinel-X**:
The product name / the system as a whole. Not a single component.

**Command Post**:
The Local Server — a **Raspberry Pi 4** running the containerized stack (broker, DB, API) and serving the dashboard, acting as the Wi-Fi access point, with the CSI camera as one of its senses. The single logical server of the system.
_Avoid_: server, PC, base, local server.

**AI Worker**:
The laptop the Command Post delegates heavy inference to — vision and predictive — wired to it over Ethernet. Also the Operator's screen. An accelerator, never the server.
_Avoid_: server, backend, GPU node.

**Operator**:
The human supervising the Outpost from the dashboard.
_Avoid_: user, admin, supervisor.

### Sensing

**Probe**:
A sensor carried by the Sentinel. Committed set: DHT (temperature/humidity), air/gas, PIR (presence), accelerometer (tamper), fingerprint (operator access).
_Avoid_: sensor, detector.

**Tamper**:
Physical interference with the Sentinel itself — the box being moved, shaken or opened — detected by the accelerometer. A threat in its own right, distinct from perimeter intrusion.
_Avoid_: shock, vibration.

**Reading**:
A single periodic measurement from a Probe at a point in time (e.g. temperature = 31.2 °C at t).
_Avoid_: metric, telemetry, datapoint.

### Information flow

**Alert**:
A *change of state* in something under surveillance: a Probe crossing into warning/critical, the PIR detecting presence, the vision model seeing an intruder, the predictor flagging a drift. Transitions only — never repeated while the state holds.
_Avoid_: event, notification, warning.

**Alarm**:
The *physical response* emitted by the Sentinel — buzzer, status LEDs, and spoken/siren audio via the speaker. The reaction, not the information.
_Avoid_: alert, notification.

**Incident**:
A bounded episode, from the first Alert until full return to nominal. The unit the time-scrubber replays.
_Avoid_: event, emergency.

### Intelligence & interface

**Digital Twin**:
The live 3D model of the Outpost in the dashboard, driven in real time by the same event stream the real system emits.
_Avoid_: 3D view, simulation, model.

**Status**:
The Outpost's single headline state — `nominal`, `elevated` or `critical` — computed as the highest severity among active Alerts. The Digital Twin's overall color.
_Avoid_: threat level, score, health.

**Time-scrubber**:
The dashboard control that replays a past Incident second-by-second from recorded history.
_Avoid_: timeline, replay bar.
