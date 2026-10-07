"""The vision service: the camera in, `intrusion` Alerts and the annotated MJPEG feed out.

- `Vision`, the loop: the latest frame, the detector on every `INFER_EVERY`-th one, the tracker, the
  Alerts to post, and the servo that turns the camera to the person followed when it has one (`PAN_DRIVE`).
  Source, detector, poster, servo and clock are passed in: it runs without a camera in the tests.
- `StreamServer`, on :8000 of the internal network: `/` the annotated MJPEG feed the reverse proxy serves
  under `/camera` behind the Operator session (any query string: the dashboard adds `?attempt=N`), and
  `/health`. Nothing else.
"""

import json
import logging
import signal
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable
from urllib.parse import urlsplit

import cv2
import numpy as np

from sentinel_common.alerts import AlertClient
from sentinel_common.config import ConfigError, env_float, env_int, env_secret, env_str, env_url

from .detectors import DETECTORS, Detector, env_min_confidence, make_detector
from .pan import DRIVES, NO_DRIVE, PanDrive, PanFollower, make_pan
from .sources import MAX_HEIGHT, MAX_WIDTH, FrameSource, make_source
from .tracker import Detection, IntruderTracker

logger = logging.getLogger(__name__)

# BGR.
_RED, _GREEN, _BLACK = (40, 40, 220), (80, 200, 80), (0, 0, 0)
_FONT = cv2.FONT_HERSHEY_SIMPLEX
# How often the camera is turned a step further as it is parked, when the service stops.
_PARK_EVERY = 0.05


@dataclass(frozen=True)
class Settings:
    camera_source: str
    detector: str
    infer_every: int
    alerts_url: str
    token: str
    sentinel: str
    clear_after: float
    min_confidence: float
    http_host: str
    http_port: int
    stream_fps: float
    max_clients: int
    jpeg_quality: int
    camera_fov: float
    pan_drive: str

    def __repr__(self) -> str:
        # The token never reaches a log line.
        return f"Settings(camera_source={self.camera_source!r}, detector={self.detector!r}, http_port={self.http_port})"


def load_settings() -> Settings:
    """The service's settings from its environment. A ConfigError names the first bad variable."""
    detector = env_str("DETECTOR", "motion")
    if detector not in DETECTORS:
        raise ConfigError(f"DETECTOR: expected one of {', '.join(DETECTORS)}, got {detector!r}")
    pan_drive = env_str("PAN_DRIVE", NO_DRIVE)
    if pan_drive != NO_DRIVE and pan_drive not in DRIVES:
        raise ConfigError(f"PAN_DRIVE: expected one of {', '.join([NO_DRIVE, *DRIVES])}, got {pan_drive!r}")
    # A camera that turns sees everything move: it would follow its own turning.
    if pan_drive != NO_DRIVE and detector == "motion":
        raise ConfigError("PAN_DRIVE: a camera that turns needs a person detector, not DETECTOR=motion")
    return Settings(
        camera_source=env_str("CAMERA_SOURCE", "opencv:0"),
        detector=detector,
        infer_every=env_int("INFER_EVERY", 1, min=1, max=30),
        alerts_url=env_url("ALERTS_URL", "http://api:8080/api/v1/alerts"),
        token=env_secret("VISION_TOKEN"),
        sentinel=env_str("VISION_SENTINEL", "sentinel-01"),
        clear_after=env_float("CLEAR_AFTER_S", 3.0, min=0.5, max=60),
        min_confidence=env_min_confidence(),
        http_host=env_str("HTTP_HOST", "0.0.0.0"),
        http_port=env_int("HTTP_PORT", 8000, min=1, max=65535),
        # More would only cost the Pi's CPU: the dashboard shows a panel, not a film.
        stream_fps=env_float("STREAM_FPS", 15, min=1, max=15),
        max_clients=env_int("MAX_CLIENTS", 4, min=1, max=16),
        jpeg_quality=env_int("JPEG_QUALITY", 80, min=10, max=100),
        # The lens's horizontal field of view: the same as the Twin's (SITE.camera.fov).
        camera_fov=env_float("CAMERA_FOV_DEG", 60, min=10, max=170),
        pan_drive=pan_drive,
    )


class _Throttled:
    """One log line per problem, again only once `every` seconds passed: a detector failing on every
    frame would bury everything else."""

    def __init__(self, every: float = 60.0) -> None:
        self._every, self._last, self._at = every, None, 0.0

    def __call__(self, message: str, now: float) -> bool:
        if message == self._last and now - self._at < self._every:
            return False
        self._last, self._at = message, now
        return True


class Vision:
    """The detection loop and what the feed shows. `step()` does one turn: call it from one thread only.
    `jpeg()` and `health()` are for the HTTP threads."""

    def __init__(
        self,
        source: FrameSource,
        detector: Detector,
        post: Callable[[dict], None],
        *,
        sentinel: str = "sentinel-01",
        clear_after: float = 3.0,
        min_confidence: float = 0.5,
        infer_every: int = 1,
        stream_fps: float = 15.0,
        jpeg_quality: int = 80,
        fov: float = 60.0,
        pan: tuple[PanFollower, PanDrive] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._source, self._detector, self._post, self._clock = source, detector, post, clock
        self._sentinel, self._clear_after, self._fov = sentinel, clear_after, fov
        # What says how far the camera is turned and what turns it: neither for a fixed camera.
        self._follower, self._drive = pan if pan is not None else (None, None)
        self._min_confidence, self._infer_every = min_confidence, infer_every
        self._stream_period, self._jpeg_quality = 1 / stream_fps, jpeg_quality
        self._tracker: IntruderTracker | None = None
        self._last_index = 0
        self._frames = 0
        # When the frames came in, how long inference took: written by step(), read by health().
        self._stats_lock = threading.Lock()
        self._arrivals: deque[float] = deque()
        self._inference_ms: deque[float] = deque(maxlen=30)
        self._detections: list[Detection] = []
        self._failure = _Throttled()
        # What the feed shows, written by step(), read by the HTTP threads.
        self._view_lock = threading.Lock()
        # Frame index, image, boxes, and the one of them that is followed.
        self._view: tuple[int, np.ndarray, list[Detection], list[int] | None] | None = None
        # One encoding per frame shown, however many clients watch.
        self._jpeg_lock = threading.Lock()
        self._jpeg: tuple[object, float, bytes] | None = None

    def run(self, stop: threading.Event, poll: float = 0.01) -> None:
        """Turns until `stop` is set. Polled: a new frame is picked up within `poll` seconds."""
        while not stop.is_set():
            self.step()
            stop.wait(poll)

    def step(self) -> None:
        now = self._clock()
        frame = self._source.read()
        if frame is not None and frame.index != self._last_index:
            self._last_index = frame.index
            with self._stats_lock:
                self._arrivals.append(now)
                # The frames of the last 2 s make the frame rate.
                while now - self._arrivals[0] > 2.0:
                    self._arrivals.popleft()
            # Counted from the first frame, which is inferred: someone already there is seen at once.
            if self._frames % self._infer_every == 0:
                # How old the frame is, on the clock it was stamped with: the camera has turned since.
                self._infer(frame.image, now, max(0.0, time.monotonic() - frame.at))
            self._frames += 1
            followed = self._tracker.followed_box if self._tracker is not None else None
            with self._view_lock:
                self._view = (frame.index, frame.image, list(self._detections), followed)
        # Also between frames: a camera that stalls still clears the intrusion after CLEAR_AFTER_S.
        if self._tracker is not None:
            self._send(self._tracker.tick(now))
        # And the servo turns on toward where the last inference sent it.
        if self._follower is not None:
            self._drive.turn(self._follower.step(now))

    def finish(self, sleep: Callable[[float], None] = time.sleep) -> None:
        """At shutdown: clears the intrusion in progress, which the api would otherwise keep raised, and
        parks the camera where it rests, where the next start takes it to be."""
        if self._tracker is not None:
            self._send(self._tracker.tick(self._clock() + self._clear_after))
        if self._follower is not None:
            for angle in self._follower.way_home(_PARK_EVERY):
                self._drive.turn(angle)
                sleep(_PARK_EVERY)
            self._drive.close()

    def health(self) -> dict:
        now = self._clock()
        with self._stats_lock:
            # None left for a camera that stopped: 0 fps.
            arrivals = [at for at in self._arrivals if now - at <= 2.0]
            timings = list(self._inference_ms)
        span = arrivals[-1] - arrivals[0] if len(arrivals) > 1 else 0.0
        fps = (len(arrivals) - 1) / span if span > 0 else 0.0
        health = {
            "camera": "ok" if self._source.ok else "down",
            "fps": round(fps, 1),
            "inference_ms": round(sum(timings) / len(timings), 1) if timings else None,
            "detector": self._detector.name,
        }
        # Only a camera that turns says how far.
        if self._follower is not None:
            health["pan"] = round(self._follower.angle, 1)
        return health

    def jpeg(self) -> tuple[object, bytes]:
        """The feed's current picture, JPEG, and a key that changes when the picture does: the last frame
        annotated, or a "camera down" card while there is none. Encoded at most `stream_fps` times a second."""
        now = time.monotonic()
        with self._jpeg_lock:
            if self._jpeg is not None and now - self._jpeg[1] < self._stream_period:
                return self._jpeg[0], self._jpeg[2]
            with self._view_lock:
                view = self._view
            if self._source.ok and view is not None:
                key = view[0]
                image = None if self._jpeg is not None and self._jpeg[0] == key else self._annotate(*view[1:])
            else:
                # Changes once a second: the client still gets a part now and then, which is how a
                # client that left is noticed.
                key = ("down", int(now))
                image = None if self._jpeg is not None and self._jpeg[0] == key else self._card(view)
            if image is not None:
                ok, data = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, self._jpeg_quality])
                if ok:
                    self._jpeg = (key, now, data.tobytes())
            assert self._jpeg is not None
            return self._jpeg[0], self._jpeg[2]

    def _infer(self, image: np.ndarray, now: float, age: float = 0.0) -> None:
        if self._tracker is None:
            height, width = image.shape[:2]
            self._tracker = IntruderTracker(
                width, height, sentinel=self._sentinel, clear_after=self._clear_after, fov=self._fov
            )
        # How far the camera was turned when the image was taken: what it shows is seen from there.
        pan = self._follower.angle_at(now - age) if self._follower is not None else 0.0
        started = time.perf_counter()
        try:
            detections = self._detector.detect(image)
        except Exception as error:
            # One bad frame, or a detector gone wrong for good: either way the feed and the clear go on.
            if self._failure(repr(error), now):
                logger.exception("Detector %s failed", self._detector.name)
            detections = []
        with self._stats_lock:
            self._inference_ms.append((time.perf_counter() - started) * 1000)
        self._detections = [d for d in detections if d.confidence >= self._min_confidence]
        self._send(self._tracker.update(self._detections, now, pan=pan))
        if self._follower is not None:
            # It turns for an intrusion, not for the first sighting of what may be nobody.
            if self._tracker.active:
                self._follower.aim(self._tracker.target, now)
            else:
                self._follower.rest(now)

    def _send(self, alerts: list[dict]) -> None:
        for alert in alerts:
            logger.info("intrusion %s %s x_norm=%s", alert["alert_id"], alert["state"], alert["detail"]["x_norm"])
            self._post(alert)

    def _annotate(self, image: np.ndarray, detections: list[Detection], followed: list[int] | None) -> np.ndarray:
        # A copy: the source hands the same frame to the detector.
        image = image.copy()
        for d in detections:
            left, top = int(d.x), int(d.y)
            cv2.rectangle(image, (left, top), (int(d.x + d.w), int(d.y + d.h)), _RED, 1 if followed else 2)
            _label(image, f"{d.confidence * 100:.0f} %", (left, max(top - 4, 14)), _RED)
        # Of several people, the one the Alert places and the camera turns to: a heavier box.
        if followed is not None:
            left, top, width, height = followed
            cv2.rectangle(image, (left, top), (left + width, top + height), _RED, 3)
        health = self.health()
        intrusion = self._tracker is not None and self._tracker.active
        state = "INTRUSION" if intrusion else "clear"
        ms = health["inference_ms"]
        line = f"{datetime.now():%H:%M:%S}  {health['fps']:.0f} fps  {self._detector.name} {ms if ms is not None else '-'} ms  {state}"
        if "pan" in health:
            line += f"  pan {health['pan']:+.0f}"
        _label(image, line, (8, 20), _RED if intrusion else _GREEN)
        return image

    def _card(self, view: tuple | None) -> np.ndarray:
        # The size of the frames when there were some, so the dashboard's panel does not jump.
        height, width = view[1].shape[:2] if view is not None else (MAX_HEIGHT, MAX_WIDTH)
        image = np.full((height, width, 3), 32, np.uint8)
        _label(image, f"{datetime.now():%H:%M:%S}  camera down, retrying", (8, 20), _RED)
        return image


def _label(image: np.ndarray, text: str, origin: tuple[int, int], color: tuple[int, int, int]) -> None:
    # On a dark band: readable over a bright scene as over a dark one.
    (width, height), baseline = cv2.getTextSize(text, _FONT, 0.5, 1)
    x, y = origin
    cv2.rectangle(image, (x - 3, y - height - 4), (x + width + 3, y + baseline + 1), _BLACK, -1)
    cv2.putText(image, text, (x, y), _FONT, 0.5, color, 1, cv2.LINE_AA)


class _QuietServer(ThreadingHTTPServer):
    # Daemon threads (ThreadingHTTPServer's default): a feed left open does not hold the exit.
    def handle_error(self, request, client_address) -> None:
        # A client gone in the middle of an answer is ordinary; anything else is a bug worth its traceback.
        if not isinstance(sys.exc_info()[1], OSError):
            logger.exception("Error answering %s", client_address[0])


class StreamServer:
    """`GET /` the MJPEG feed, `GET /health` the state of the camera; on daemon threads.

    At most `max_clients` feeds at once, each at most `fps` pictures a second: the Pi's CPU goes to
    detection first. Requests are not logged: the feed is one long request per client anyway.
    """

    def __init__(self, vision: Vision, host: str, port: int, *, fps: float = 15.0, max_clients: int = 4) -> None:
        self._vision, self._period, self._max_clients = vision, 1 / fps, max_clients
        self._clients = 0
        self._lock = threading.Lock()
        self._closing = threading.Event()
        self._server = _QuietServer((host, port), self._handler())
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    @property
    def clients(self) -> int:
        return self._clients

    def start(self) -> None:
        self._thread = threading.Thread(target=self._server.serve_forever, args=(0.2,), name="http", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._closing.set()
        self._server.shutdown()
        self._server.server_close()

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        server = self

        class Handler(BaseHTTPRequestHandler):
            # A client that stops reading must not hold its slot and its thread forever.
            timeout = 10

            def do_GET(self) -> None:
                path = urlsplit(self.path).path
                if path == "/":
                    server._stream(self)
                elif path == "/health":
                    server._health(self)
                else:
                    server._answer(self, 404, {"error": "not found"})

            def log_message(self, format: str, *args: object) -> None:
                pass

        return Handler

    def _answer(self, request: BaseHTTPRequestHandler, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        request.send_response(status)
        request.send_header("Content-Type", "application/json")
        request.send_header("Content-Length", str(len(payload)))
        request.send_header("Cache-Control", "no-store")
        request.end_headers()
        request.wfile.write(payload)

    def _health(self, request: BaseHTTPRequestHandler) -> None:
        health = {**self._vision.health(), "clients": self._clients}
        self._answer(request, 200 if health["camera"] == "ok" else 503, health)

    def _stream(self, request: BaseHTTPRequestHandler) -> None:
        with self._lock:
            full = self._clients >= self._max_clients
            if not full:
                self._clients += 1
        if full:
            self._answer(request, 503, {"error": f"{self._max_clients} clients already watch the feed"})
            return
        try:
            request.send_response(200)
            request.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            request.send_header("Cache-Control", "no-store")
            request.end_headers()
            last = None
            while not self._closing.is_set():
                started = time.monotonic()
                key, jpeg = self._vision.jpeg()
                if key != last:
                    last = key
                    request.wfile.write(
                        b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n%s\r\n" % (len(jpeg), jpeg)
                    )
                    request.wfile.flush()
                self._closing.wait(max(0.0, self._period - (time.monotonic() - started)))
        except OSError:
            # The client left, or stopped reading for `timeout` seconds: nothing to report.
            pass
        finally:
            with self._lock:
                self._clients -= 1


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        settings = load_settings()
        source = make_source(settings.camera_source)
        detector = make_detector(settings.detector)
        pan = make_pan(settings.pan_drive)
    except ConfigError as error:
        sys.exit(f"Invalid configuration: {error}")

    stop = threading.Event()
    # SIGTERM from `docker stop`, SIGINT from Ctrl-C: the same clean stop.
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())

    with AlertClient(settings.alerts_url, settings.token) as alerts:
        vision = Vision(
            source,
            detector,
            alerts.post,
            sentinel=settings.sentinel,
            clear_after=settings.clear_after,
            min_confidence=settings.min_confidence,
            infer_every=settings.infer_every,
            stream_fps=settings.stream_fps,
            jpeg_quality=settings.jpeg_quality,
            fov=settings.camera_fov,
            pan=pan,
        )
        try:
            server = StreamServer(
                vision, settings.http_host, settings.http_port, fps=settings.stream_fps, max_clients=settings.max_clients
            )
        except OSError as error:
            sys.exit(f"Cannot listen on {settings.http_host}:{settings.http_port}: {error}")
        server.start()
        source.open()
        if pan is not None:
            pan[1].open()
        logger.info(
            "vision on %s:%d, camera %s, detector %s, pan %s, Alerts to %s",
            settings.http_host, server.port, settings.camera_source, settings.detector, settings.pan_drive,
            settings.alerts_url,
        )
        try:
            vision.run(stop)
        finally:
            server.close()
            source.close()
            vision.finish()
    logger.info("vision stopped")
