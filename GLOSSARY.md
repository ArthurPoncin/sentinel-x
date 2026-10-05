# Sentinel-X

Autonomous cyber-physical surveillance system for AetherCorp's remote micro–power plants. This glossary is the shared language for the whole consortium — use these terms everywhere (code, docs, commits, pitch).

## Language

### Physical entities

**Outpost**:
A protected site — one micro–power plant and its perimeter. The thing the Digital Twin is a model of.
_Avoid_: site, plant, station.

**Enclosure**:
The 3D-printed (Fusion360), laser-engraved shell that houses the Sentinel **and** the Command Post — the physical Sentinel-X product shown in the demo and the teaser.
_Avoid_: box, case, shell.

**Sentinel**:
The sensing unit: an **ESP32** with the environmental and intrusion Probes, the OLED status display and the Alarm hardware (buzzer + speaker + LEDs). Lives in the Enclosure and joins the Command Post's Wi-Fi. Carries the Probes, not the camera.
_Avoid_: box, edge node, device, module.

**Sentinel-X**:
The product name / the system as a whole. Not a single component.

**Command Post**:
The Local Server ("PC Serveur Local") — a **Raspberry Pi 5** fixed inside the Enclosure (the brief's Option A). It is the Wi-Fi access point, runs the whole containerized stack (broker, DB, API, dashboard, vision and predictive AI) and owns the USB webcam. The single server of the system.
_Avoid_: server, PC, base, local server.

**Operator**:
The human supervising the Outpost from the dashboard, in a browser on a laptop joined to the table Wi-Fi. The laptop is a client only — nothing of the system runs on it.
_Avoid_: user, admin, supervisor.

### Sensing

**Probe**:
A sensor carried by the Sentinel. Committed set: DHT22 (temperature/humidity), MQ-2 (gas/smoke), PIR HC-SR501 (presence), accelerometer (tamper), fingerprint (operator access).
_Avoid_: sensor, detector.

**Tamper**:
Physical interference with the Enclosure itself — moved, shaken or opened — detected by the accelerometer. A threat in its own right, distinct from perimeter intrusion.
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
