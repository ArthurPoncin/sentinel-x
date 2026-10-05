# ai/ — Local AI & Data

**Owner:** Dev 2 · **Language:** Python

Standalone AI running on the Local Server. Two jobs: **see** (webcam intrusion detection) and **predict** (correlation-based maintenance anomalies).

## Vision — intrusion detection
- Capture the USB webcam feed directly on the Local Server.
- Resize/throttle frames (**≤ 640x480**, target **< 100ms/frame**).
- Detect a suspicious human presence (YOLOv8-tiny or OpenCV shape detection).
- Emit intrusion events (with position) to the API → spawns the intruder in the 3D twin.

## Predictive maintenance
- Analyze sensor time-series streamed from the ESP8266.
- **No static thresholds** (`if temp>40` is forbidden). Use a learned model (Isolation Forest / Random Forest, scikit-learn).
- Goal: catch a *correlation* — e.g. slow temp rise + micro gas deviation → predict an incident *before* the critical threshold.

## TODO
- [ ] Webcam capture + resize pipeline
- [ ] Inference model + event emitter
- [ ] Time-series ingestion from API/DB
- [ ] Train anomaly model on captured sensor data
- [ ] Latency check (< 100ms/frame)

> Model weights (`*.pt`, `*.onnx`) are gitignored — share via a release or drive.
