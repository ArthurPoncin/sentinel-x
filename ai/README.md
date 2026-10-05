# ai/ — Local AI & Data

**Node:** Command Post (Raspberry Pi 5) · **Language:** Python · **Runs as:** `vision` and `predictive` containers in the Pi's Docker-Compose stack

Two jobs, both on the Pi (the brief's Option A): **see** (intrusion on the USB webcam) and **predict** (correlation-based maintenance). Results are posted to the API as Alerts.

## Vision — intrusion detection
- Capture the **USB webcam** plugged into the Pi (`/dev/video0`, passed to the container with `devices:` — never `privileged`).
- Resize/throttle frames (**≤ 640x480**, target **< 100 ms/frame**).
- Detect a suspicious human presence (YOLOv8-tiny or OpenCV shape detection).
- Emit an `intrusion` Alert with **`x_norm`** (normalized horizontal position 0→1) so the 3D twin can place the intruder along the perimeter.
- `vision` is the only process that opens the webcam, so it also **serves the camera feed** to the dashboard (MJPEG, detections drawn), through the reverse proxy behind the Operator session.

### Performance on the Pi — benchmark Monday
The main technical risk of Option A. Levers, in order:
1. YOLOv8n exported to **NCNN**, model input **320** (capture stays 640x480).
2. Infer every 2nd–3rd frame; keep the displayed stream at full rate.
3. Fallback allowed by the brief: **OpenCV** motion detection (MOG2) + HOG person detector.

## Predictive maintenance
- **Live:** subscribe to `sentinel/+/telemetry` over MQTTS (`mosquitto:8883`, own `predictive` MQTT user, broker verified against the team CA) and score a sliding window in memory.
- **Training:** nominal history from the DB (**read-only** DB user).
- **No static thresholds** (`if temp>40` is forbidden). Isolation Forest on an enriched vector: `[temp, humidity, air]` **+ velocity features** `[Δtemp/dt, Δair/dt]` + rolling means.
- Goal: catch the *correlation* — slow temp rise + micro air deviation → predict an incident **before** the critical threshold. Emits a `predictive` Alert with `anomaly_score`.
- Train on **nominal data only**, captured Tuesday (2–4 h). No labelled incidents needed.
- Data quality: the DHT22/MQ-2 sit in their own ventilated compartment, away from the Pi — otherwise the model learns the Pi's inference heat as "thermal drift".

## Output
Both jobs → `POST /api/v1/alerts` over the **internal Docker network**, using the unified Alert schema in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts). Each service sends its own token (`Authorization: Bearer …`, from its `.env`) and may only post its own `kind` (`intrusion` / `predictive`).

## TODO
- [ ] Webcam capture on the Pi + **latency benchmark (Monday)**
- [ ] Vision inference + `x_norm` extraction
- [ ] Annotated MJPEG feed for the dashboard
- [ ] Tuesday nominal-data capture session
- [ ] MQTTS telemetry subscriber (sliding window)
- [ ] Feature engineering + train Isolation Forest
- [ ] Alert POST client (with service token)

> Model weights (`*.pt`, `*.onnx`, NCNN exports) are gitignored — share via a release or drive. Tokens live in `.env` (gitignored).
