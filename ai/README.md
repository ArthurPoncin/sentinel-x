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

### The service — `python -m vision`
The camera in, the tracker's Alerts posted with `VISION_TOKEN`, the annotated feed out. Runs on a laptop with a webcam or a video file: no Pi needed.
- **Source** (`vision.sources`, `CAMERA_SOURCE`): `opencv:0` a webcam, `opencv:/path/video.mp4` a video file played in a loop at its own frame rate. Frames larger than 640x480 are shrunk, proportions kept. A capture thread keeps only the **latest** frame. A camera absent or lost stops nothing: `/health` says `down`, the feed shows a "camera down" card, and the source opens it again on its own (after 0.5 s, doubling up to every 10 s).
- **Detector** (`vision.detectors`, `DETECTOR`): `motion`, OpenCV's MOG2 background subtraction, worked at 320 px wide; the largest blobs are the detections, `confidence` = blob area / 4 % of the frame (about a person at the fence), capped at 1. It learns the still scene for 20 frames before reporting anything, and someone who stops moving fades into the background within seconds: motion says someone moves, not that someone is there.
- **Loop** (`vision.service.Vision`): the detector on every `INFER_EVERY`-th new frame, detections under `MIN_CONFIDENCE` dropped, the tracker's Alerts queued on the Alert client. The tracker is ticked between frames too, so a camera that stalls still clears. On SIGTERM / Ctrl-C it stops, clears the intrusion in progress (the api would keep it raised) and sends what is queued.
- **HTTP** on `HTTP_PORT` (8000), never published: the reverse proxy serves it under `/camera`, behind the Operator session.
  - `GET /`, whatever the query string (the dashboard asks for `/camera?attempt=N`, the proxy strips `/camera`): `multipart/x-mixed-replace; boundary=frame`, the latest frame with its boxes, their confidence and a status line (time, fps, inference ms, `INTRUSION` / `clear`), at most `STREAM_FPS` (15) a second, each picture encoded once for every client. `MAX_CLIENTS` (4) at once; the next one gets a `503`.
  - `GET /health`: `{"camera": "ok"|"down", "fps", "inference_ms", "clients", "detector"}`, `200` while the camera works, `503` when it is down. Anything else is a `404`. Requests are not logged.
- **Configuration**, all from the environment: [`vision/.env.example`](vision/.env.example). `VISION_TOKEN` is required (32 characters or more); a bad variable stops the service at start, with its name.
- **Another source or detector** (Picamera2 #46, TFLite #74): a `CaptureThread` subclass with `_connect` / `_grab` / `_disconnect` and a line in `SOURCES`; a class with `name` and `detect(image) -> list[Detection]` and a line in `DETECTORS`.

**In development**, three terminals from the repository's root (the `ai/` venv as in [Develop & test](#develop--test)):

```bash
# the api, taking the vision token, without the mock (its scripted intruder would mix with yours)
openssl rand -hex 32 > /tmp/vision-token
cd backend && VISION_TOKEN=$(cat /tmp/vision-token) OPERATOR_AUTH=off MOCK_FEED=false HISTORY_FILE=:memory: npm run dev

# vision on the laptop's webcam (or CAMERA_SOURCE=opencv:/path/video.mp4), its feed on 127.0.0.1 only
cd ai && PYTHONPATH=common:vision CAMERA_SOURCE=opencv:0 ALERTS_URL=http://127.0.0.1:8080/api/v1/alerts \
  VISION_TOKEN=$(cat /tmp/vision-token) HTTP_HOST=127.0.0.1 .venv/bin/python -m vision

# the dashboard on http://localhost:5173, its camera panel on that feed
cd dashboard && CAMERA_URL=http://127.0.0.1:8000 npm run dev
```

Walk in front of the camera: the panel draws the box, the intruder appears on the Twin, and `curl -s 127.0.0.1:8000/health` gives the frame rate and the inference time.

### Performance on the Pi 4 — benchmark Monday
The main technical risk of Option A, on a Pi 4 that is slower than the Pi 5 the brief assumes: TFLite detection on its CPU runs at a few frames per second. Levers, in order:
1. EfficientDet-Lite0 at its native **320** input (capture stays 640x480); switch to SSD MobileNet if it benchmarks faster.
2. Infer every 2nd–3rd frame, and only when the motion detector sees movement; keep the displayed stream at full rate.
3. Fallback allowed by the brief: **OpenCV** motion detection alone.

## Predictive maintenance
- **Live:** subscribe to `sentinel/+/telemetry` over MQTTS (`mosquitto:8883`, own `predictive` MQTT user, broker verified against the team CA) and score a sliding window in memory.
- **Training:** nominal history from the api's SQLite history, opened **read-only** (`mode=ro`, `api-data` volume mounted `:ro`) — see *Capture & training* below.
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

### Capture & training — Tuesday
`python -m predictive train --from <ISO> --to <ISO>` (`predictive.training`, `predictive.history`) reads the telemetry of the range from `HISTORY_FILE` (default `/history/history.sqlite`, the api's history, the time-scrubber's), opened read-only and while the api writes; `--history <file>` reads another copy, `--jsonl <file>` a capture made away from the Pi (one telemetry payload, Alert or history frame per line). Both ends of the range are included; a time without its zone is refused.
- **Kept:** the telemetry, Sentinel by Sentinel, through the live service's window. **Left out:** the snapshots taken while one of the Sentinel's own Alerts (`gas`, `thermal`, `presence`, `noise`) was active, from its `raised` to the `cleared` of the same `alert_id` — also one raised before `--from`, and to the end of the range if it is never cleared. No window spans such a period, so the levels before and after it make no slope.
- **Refused**, with what to do: a range the api's mock fed (an Alert whose `alert_id` starts with `mock-` in it, or still active at its start), a range with no telemetry, too little nominal (< 100 vectors). Nothing is saved then.
- **Saved** to `MODEL_FILE` (default `/model/model.joblib`, the `predictive-model` volume, out of git), with its range, its number of vectors, its learned levels and its format and scikit-learn versions; the file is replaced in one move, so a running service never reads half of it.

The procedure:
1. Run the stack with the real Sentinel and **`MOCK_FEED` off** (the mock is recorded like a real Sentinel: a range it fed is refused), sensors in their ventilated compartment, the room as it will be for the demo: ventilation, door, people around, the Pi under its usual load. Change nothing during the capture that the demo will not have.
2. Note the start time **in UTC** (`date -u +%FT%TZ`), let it run **2–4 h**, note the end. Don't trigger the Sentinel on purpose: a period under one of its Alerts is left out, so its time is lost to the capture.
3. Train (a few seconds on the Pi), the api still running — a read-only reader needs the `-shm` file only the running api keeps:
   ```bash
   docker compose run --rm predictive train --from 2026-10-13T08:00:00Z --to 2026-10-13T11:00:00Z
   ```
   The `predictive` service, its volumes and environment are wired in the Compose stack (`docker-compose.yml`, [`../infra/README.md`](../infra/README.md#the-ai-services)). Without it, from `ai/`: `PYTHONPATH=common:predictive .venv/bin/python -m predictive train --from … --to … --history <copy of history.sqlite> --model <file>`.
4. Read the summary (here on 4 h of synthetic telemetry, with a 5 min `presence` Alert in it):
   ```
   sentinel-01: 14400 snapshots, 14099 kept, 301 excluded (Alert active), 0 invalid → 13979 vectors
     excluded from 2026-10-06T09:00:00.000Z to 2026-10-06T09:05:00.000Z: presence Alert active
   Trained on 13979 vectors: raise at 0.589, clear under 0.565 (learned quantiles of held-out nominal scores).
   On its own training windows: 0.02% score at or above the raise level, a replay raises 0 predictive Alerts.
   ```
   - *snapshots / kept / excluded / invalid*: what the range held for each Sentinel; ~1 snapshot per second is expected. Many excluded or invalid: look at the Alerts or the Sentinel before trusting the capture.
   - *vectors*: one per kept snapshot once its window is full, the first minute of each run aside.
   - *raise at / clear under*: the learned levels the live service compares the anomaly score to.
   - *on its own training windows*: a sanity check — a share well under 1 % and a replay that raises nothing. A replay that raises on the capture itself means the capture holds an episode that is not nominal: find it in the time-scrubber and train on a range without it.

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
