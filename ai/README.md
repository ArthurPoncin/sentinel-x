# ai/ — Local AI & Data

**Node:** Command Post (Raspberry Pi 4) · **Language:** Python · **Runs as:** `vision` and `predictive` containers in the Pi's Docker-Compose stack

Two jobs, both on the Pi (the brief's Option A): **see** (intrusion on the ZIF camera) and **predict** (correlation-based maintenance). Results are posted to the API as Alerts.

## Vision — intrusion detection
- **Base:** [`automaticdai/rpi-object-detection`](https://github.com/automaticdai/rpi-object-detection) (MIT) — lightweight Python + OpenCV, built for the Pi. We reuse `src/object-detection-tflite` (EfficientDet-Lite0 or SSD MobileNet, COCO labels) and keep only the `person` class; `src/motion-detection` (OpenCV) is the fallback. Keep its license notice in the copied code.
- Capture the **ZIF camera** (Joy-IT RB-Camera-JT, OV5647, on the CSI port) with **Picamera2**, which the repo already supports — OpenCV's `VideoCapture` can't read a CSI camera directly. In the container: the camera device nodes (`/dev/video*`, `/dev/media*`) passed with `devices:` — never `privileged` — and Picamera2 from the Raspberry Pi apt repo.
- Resize/throttle frames (**≤ 640x480**, target **< 100 ms/frame**).
- Emit an `intrusion` Alert with **`x_norm`** (normalized horizontal position 0→1) so the 3D twin can place the intruder along the perimeter.
- `vision` is the only process that opens the camera, so it also **serves the camera feed** to the dashboard (MJPEG, detections drawn), through the reverse proxy behind the Operator session.

### The intrusion Alert's lifecycle — `vision.tracker.IntruderTracker`
Pure, camera and model aside: each inference's person boxes in, the Alerts to post out, the time passed in by the caller.
- **One intruder at a time**, the most confident person: `x_norm` = the box's horizontal centre / image width, clamped to 0→1; `bbox` = `[x, y, w, h]` in whole pixels of the captured image, clipped to it. `severity: critical`.
- **`raised`** once a person is seen on **2 inferences in a row**: a one-frame flash raises nothing.
- **`raised` again, same `alert_id`**, when `x_norm` moved by **≥ 0.05** since the last Alert sent, **at most every 500 ms**; a move made inside those 500 ms is sent once they are over. Someone standing still sends nothing.
- **`cleared`** once nobody has been seen for **3 s** (`CLEAR_AFTER_S`), with the last known detail — also when inference stalls, through `tick()`. A shorter miss changes nothing; whoever comes after a clear gets a new `alert_id`.

### Performance on the Pi 4 — benchmark Monday
The main technical risk of Option A, on a Pi 4 that is slower than the Pi 5 the brief assumes: TFLite detection on its CPU runs at a few frames per second. Levers, in order:
1. EfficientDet-Lite0 at its native **320** input (capture stays 640x480); switch to SSD MobileNet if it benchmarks faster.
2. Infer every 2nd–3rd frame, and only when the motion detector sees movement; keep the displayed stream at full rate.
3. Fallback allowed by the brief: **OpenCV** motion detection alone.

## Predictive maintenance
- **Live:** subscribe to `sentinel/+/telemetry` over MQTTS (`mosquitto:8883`, own `predictive` MQTT user, broker verified against the team CA) and score a sliding window in memory.
- **Training:** nominal history from the DB (**read-only** DB user).
- **No static thresholds** (`if temp>40` is forbidden). Isolation Forest on an enriched vector: `[temp, humidity, air]` **+ velocity features** `[Δtemp/dt, Δair/dt]` + rolling means.
- Goal: catch the *correlation* — slow temp rise + micro air deviation → predict an incident **before** the critical threshold. Emits a `predictive` Alert with `anomaly_score`.
- Train on **nominal data only**, captured Tuesday (2–4 h). No labelled incidents needed.
- Data quality: the DHT22/MQ-2 sit in their own ventilated compartment, away from the Pi — otherwise the model learns the Pi's inference heat as "thermal drift".

**Without a Sentinel:** `PYTHONPATH=common:predictive .venv/bin/python -m predictive simulate` (from `ai/`, ~3 s) trains on 2 h of synthetic nominal, replays a slow heat + gas drift and prints when the Alert is raised against `THERMAL_WARNING` / `GAS_WARNING` (~43 min ahead), then when it clears.
- **Vector** (`predictive.features`, the same code for training and live): a 120 s window per Sentinel, scored from 20 snapshots spanning ≥ 60 s — `temp`, `humidity`, `air`, `temp_slope`, `air_slope` (least squares, per minute), `temp_mean`, `air_mean`. A snapshot that is invalid, older than or as old as the last one is dropped.
- **Model** (`predictive.model`): `StandardScaler` + `IsolationForest` (200 trees, fixed seed); `anomaly_score` is its 0–1 score. Learned levels: raise ≥ quantile 0.999, clear < quantile 0.99 of **held-out** nominal scores — each 10 min block scored by a forest that never saw it; the forest's scores of its own training windows are too kind and gave a false Alert about once a day. Refuses < 100 vectors; saved with joblib, its format version and scikit-learn version, and refused if either differs.
- **Alert** (`predictive.detector`): `raised` after 5 scores in a row at or above the raise level, `cleared` after 10 in a row under the clear level, a new `alert_id` per episode, `ts` of the snapshot that tipped it; `drivers` as in [`ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts).
- **Live:** `Model.load(path)`, one `Monitor(model, sentinel)` per Sentinel, `monitor.push(sample_of(payload))` → an Alert to post, or `None`.
- The synthetic room is stationary and bounded (ventilation cycles, drafts, probe noise): the Tuesday capture must cover the demo's conditions likewise, or the model will rightly find them odd.

### The live service — `python -m predictive run` (`predictive.service`)
The image's default command. Configured by its environment, every variable in [`predictive/.env.example`](predictive/.env.example); a missing or invalid one stops it at startup with its name.
- **Broker:** `MQTT_URL` in `mqtts://` only (port 8883 by default), user `MQTT_USERNAME` (`predictive`) / `MQTT_PASSWORD`, the broker verified against `MQTT_CA_FILE` alone, its name included (TLS ≥ 1.2). Subscribes to `sentinel/+/telemetry` each time the connection comes up; retries forever while the broker is away or refuses the login (1 s, doubling up to 30 s), saying why once.
- **Messages:** the Sentinel is the topic's `<id>` (`[\w-]{1,64}`), never the payload's. A foreign topic, a payload over 4 KB or that is not a snapshot (`sample_of`), a snapshot not newer than the last: ignored and counted, the first of each kind logged with its topic, the rest summed up every 5 min.
- **Model:** `MODEL_FILE` (`/model/model.joblib`), checked every `MODEL_POLL_S` (10 s). Without it, the service reads the telemetry, scores none of it and says so (again every 5 min). As soon as it appears, and each time it changes, it is loaded and logged with its range, levels and window, and every Sentinel starts over with a fresh window. A file that cannot be loaded is logged once and skipped: the previous model, if any, keeps scoring. So `docker compose run --rm predictive train …` is enough: the running service takes the new model up by itself.
- **Alerts:** each transition is logged with its score and drivers, and posted through the `AlertClient` with `PREDICTIVE_TOKEN` to `ALERTS_URL`. A new model, or the service stopping, first clears the episodes still raised: nobody else could clear them.
- **SIGTERM / SIGINT:** disconnects, posts what is queued (5 s at most), exits. No secret in any log line.

Against a broker, from `ai/` (with a model saved by `Model.save`, e.g. the Pi's, copied):

```bash
MQTT_URL=mqtts://<pi-ip>:8883 MQTT_PASSWORD=… MQTT_CA_FILE=../infra/secrets/ca.crt \
ALERTS_URL=http://127.0.0.1:8080/api/v1/alerts PREDICTIVE_TOKEN=… MODEL_FILE=model.joblib \
PYTHONPATH=common:predictive .venv/bin/python -m predictive run
```

The image: `docker build -f ai/predictive/Dockerfile ai/` (the context is `ai/`, for `ai/common`); non-root (uid 10001), runs with `read_only` and `cap_drop: ALL`; the model lives on a volume at `/model`.

## Output
Both jobs → `POST /api/v1/alerts` over the **internal Docker network**, using the unified Alert schema in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#alert--sentinelidalert-and-body-of-post-apiv1alerts). Each service sends its own token (`Authorization: Bearer …`, from its `.env`) and may only post its own `kind` (`intrusion` / `predictive`).

### The Alert client — `sentinel_common.alerts`
Both services post through one `AlertClient`: `post()` only queues the Alert, so the detection loop never waits on the network, and a single worker sends the queue in order, so a `cleared` never overtakes its `raised`.

- **Retried** with an exponential backoff (0.5 s, doubling, capped at 8 s, 5 sends at most): a network error, a `5xx`, a `429` after its `Retry-After`. Out of attempts, the Alert is logged and dropped: the next ones still go.
- **Not retried:** any other `4xx` — the Alert itself is wrong. Logged with the api's `message`, then skipped.
- Never through an HTTP proxy, never after a redirect, and the token appears in no log line nor `repr()`.
- `close()` (or leaving the `with`) sends what is queued, for 5 s at most: call it before exiting.

The configuration is the service's: it reads its own variables with `sentinel_common.config`, at startup, so a missing or invalid one stops it with its name — never with a secret's value.

```python
import sys

from sentinel_common.alerts import AlertClient
from sentinel_common.config import ConfigError, env_secret, env_url

try:
    url = env_url("ALERTS_URL", "http://api:8080/api/v1/alerts")
    token = env_secret("VISION_TOKEN")  # predictive: PREDICTIVE_TOKEN
except ConfigError as error:
    sys.exit(f"Invalid configuration: {error}")

with AlertClient(url, token) as alerts:
    ...
    alerts.post(alert)  # returns at once
```

## Develop & test
Product requirements: the AI PRD, issue #67. Layout, one import package per directory:

```
ai/
├── common/       # sentinel_common: the Alert contract mirror, the Alert client — stdlib only, Python 3.11+
├── predictive/   # predictive: the predictive service
└── vision/       # vision: the vision service
```

Everything is tested without a Pi, a camera, a broker or a network, from `ai/`:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

Every Alert a service emits is checked against `sentinel_common.contract.alert_errors`, the mirror of
`backend/src/contract.ts`: what it refuses, the api refuses with a `400`.

## TODO
- [ ] ZIF camera capture (Picamera2) on the Pi + **latency benchmark (Monday)**
- [ ] Vision inference + `x_norm` extraction
- [ ] Annotated MJPEG feed for the dashboard
- [ ] Tuesday nominal-data capture session
- [ ] MQTTS telemetry subscriber (sliding window)
- [ ] Feature engineering + train Isolation Forest
- [ ] Alert POST client (with service token)

> Model weights (`*.tflite`, `*.pt`, `*.onnx`) are gitignored — share via a release or drive. Tokens live in `.env` (gitignored).
