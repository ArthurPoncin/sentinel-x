# ai/ — Local AI & Data

**Node:** AI Worker (laptop) · **Language:** Python

Heavy inference the Command Post (Pi 4) can't run itself. Two jobs: **see** (intrusion on the camera stream) and **predict** (correlation-based maintenance). Results are posted to the API as Alerts.

## Vision — intrusion detection
- Pull the **CSI camera stream** from the Command Post over wired Ethernet (the camera is physically on the Pi).
- Resize/throttle frames (**≤ 640x480**, target **< 100 ms/frame**).
- Detect a suspicious human presence (YOLOv8-tiny or OpenCV shape detection).
- Emit an `intrusion` Alert with **`x_norm`** (normalized horizontal position 0→1) so the 3D twin can place the intruder along the perimeter.

## Predictive maintenance
- Analyze the sensor time-series (telemetry from the Sentinel via the API/DB).
- **No static thresholds** (`if temp>40` is forbidden). Isolation Forest on an enriched vector: `[temp, humidity, air]` **+ velocity features** `[Δtemp/dt, Δair/dt]` + rolling means.
- Goal: catch the *correlation* — slow temp rise + micro air deviation → predict an incident **before** the critical threshold. Emits a `predictive` Alert with `anomaly_score`.
- Train on **nominal data only**, captured Tuesday (2–4 h). No labelled incidents needed.

## Output
Both jobs → `HTTPS POST /api/v1/alerts` using the unified Alert schema in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts).

## TODO
- [ ] Pull + decode the Pi camera stream (Ethernet)
- [ ] Vision inference + `x_norm` extraction
- [ ] Latency check (< 100 ms/frame)
- [ ] Tuesday nominal-data capture session
- [ ] Feature engineering + train Isolation Forest
- [ ] Alert POST client

> Model weights (`*.pt`, `*.onnx`) are gitignored — share via a release or drive.
