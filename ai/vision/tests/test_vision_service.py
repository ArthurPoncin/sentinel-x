import http.client
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import pytest

from sentinel_common.alerts import AlertClient
from sentinel_common.config import ConfigError
from sentinel_common.contract import alert_errors
from vision.detectors import MotionDetector
from vision.pan import PanFollower
from vision.service import StreamServer, Vision, load_settings
from vision.sources import Frame
from vision.tracker import Detection

from .test_detectors import Scene

TOKEN = "vision-token-0123456789abcdef0123456789abcdef"
WIDTH, HEIGHT = 640, 480


class FakeSource:
    """A camera driven by the test: `show()` captures a frame, `ok` says whether it works."""

    def __init__(self):
        self.frame = None
        self.ok = True
        self.width = self.height = None

    def show(self, image=None):
        image = np.full((HEIGHT, WIDTH, 3), 90, np.uint8) if image is None else image
        index = self.frame.index + 1 if self.frame else 1
        self.frame = Frame(image, index, time.monotonic())
        self.height, self.width = image.shape[:2]

    def open(self):
        pass

    def read(self):
        return self.frame

    def close(self):
        pass


class FakeDetector:
    """Sees, on each call, the next list of `script` (nobody once it runs out), or raises it."""

    name = "fake"

    def __init__(self, *script):
        self.script = list(script)
        self.calls = 0

    def detect(self, image):
        self.calls += 1
        result = self.script.pop(0) if self.script else []
        if isinstance(result, Exception):
            raise result
        return result


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def person(x_norm, confidence=0.9):
    return Detection(x=x_norm * WIDTH - 30, y=80, w=60, h=180, confidence=confidence)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def posted():
    return []


def make_vision(source, detector, posted, clock, **options):
    def post(alert):
        assert alert_errors(alert) == [], alert
        posted.append(alert)

    return Vision(source, detector, post, clock=clock, **options)


def frame_at(vision, source, clock, seconds=0.1, image=None):
    """A new frame `seconds` after the last one, and the loop's turn on it."""
    clock.now += seconds
    source.show(image)
    vision.step()


# --- the loop -----------------------------------------------------------------------------------------


def test_someone_seen_twice_raises_moves_then_clears_once_gone(clock, posted):
    source = FakeSource()
    vision = make_vision(source, FakeDetector([person(0.2)], [person(0.2)], [person(0.6)]), posted, clock)
    frame_at(vision, source, clock)
    assert posted == []
    frame_at(vision, source, clock)
    assert [(a["state"], a["detail"]["x_norm"]) for a in posted] == [("raised", 0.2)]
    frame_at(vision, source, clock, seconds=0.5)
    assert [(a["state"], a["detail"]["x_norm"]) for a in posted][1:] == [("raised", 0.6)]
    for _ in range(29):
        frame_at(vision, source, clock)
    assert len(posted) == 2
    frame_at(vision, source, clock)
    assert [a["state"] for a in posted] == ["raised", "raised", "cleared"]
    assert len({a["alert_id"] for a in posted}) == 1
    assert {a["sentinel"] for a in posted} == {"sentinel-01"}


def test_a_stalled_camera_still_clears(clock, posted):
    source = FakeSource()
    vision = make_vision(source, FakeDetector([person(0.5)], [person(0.5)]), posted, clock, clear_after=3.0)
    frame_at(vision, source, clock)
    frame_at(vision, source, clock)
    assert [a["state"] for a in posted] == ["raised"]
    # No new frame: the same one read again, nothing inferred, the tracker ticked all the same.
    for _ in range(29):
        clock.now += 0.1
        vision.step()
    assert len(posted) == 1
    clock.now += 0.1
    vision.step()
    assert [a["state"] for a in posted] == ["raised", "cleared"]


def test_inference_runs_on_every_nth_new_frame_only(clock, posted):
    source, detector = FakeSource(), FakeDetector()
    vision = make_vision(source, detector, posted, clock, infer_every=3)
    for _ in range(7):
        frame_at(vision, source, clock)
        # The same frame again infers nothing.
        vision.step()
    # Frames 1, 4 and 7.
    assert detector.calls == 3


def test_detections_under_min_confidence_are_dropped(clock, posted):
    source = FakeSource()
    detector = FakeDetector(*[[person(0.3, confidence=0.4)]] * 3)
    vision = make_vision(source, detector, posted, clock, min_confidence=0.5)
    for _ in range(3):
        frame_at(vision, source, clock)
    assert posted == []


def test_a_detector_that_fails_stops_nothing(clock, posted):
    source = FakeSource()
    detector = FakeDetector(RuntimeError("model gone"), [person(0.5)], [person(0.5)])
    vision = make_vision(source, detector, posted, clock)
    for _ in range(3):
        frame_at(vision, source, clock)
    assert [a["state"] for a in posted] == ["raised"]
    assert vision.jpeg()[1][:2] == b"\xff\xd8"


def test_finish_clears_the_intrusion_in_progress(clock, posted):
    source = FakeSource()
    vision = make_vision(source, FakeDetector([person(0.5)], [person(0.5)]), posted, clock)
    vision.finish()
    assert posted == []
    frame_at(vision, source, clock)
    frame_at(vision, source, clock)
    vision.finish()
    assert [a["state"] for a in posted] == ["raised", "cleared"]


def test_motion_from_a_moving_rectangle_raises_with_its_x_norm(clock, posted):
    scene, source = Scene(seed=5), FakeSource()
    vision = make_vision(source, MotionDetector(), posted, clock)
    for _ in range(30):
        frame_at(vision, source, clock, image=scene.frame())
    assert posted == []
    for x in range(100, 140, 8):
        frame_at(vision, source, clock, image=scene.frame(x))
    assert [a["state"] for a in posted] == ["raised"]
    # Raised on the second frame with the rectangle, at x = 108.
    assert posted[0]["detail"]["x_norm"] == pytest.approx((108 + 30) / WIDTH, abs=0.01)


def test_health_gives_the_camera_the_frame_rate_and_the_inference_time(clock, posted):
    source = FakeSource()
    vision = make_vision(source, FakeDetector(), posted, clock)
    assert vision.health() == {"camera": "ok", "fps": 0.0, "inference_ms": None, "detector": "fake"}
    for _ in range(21):
        frame_at(vision, source, clock, seconds=0.1)
    health = vision.health()
    assert health["fps"] == 10.0
    assert isinstance(health["inference_ms"], float) and health["inference_ms"] >= 0
    source.ok = False
    clock.now += 3
    assert vision.health()["camera"] == "down"
    assert vision.health()["fps"] == 0.0


# --- the camera on its servo --------------------------------------------------------------------------


class FakeDrive:
    """A servo that only notes where it is told to turn."""

    name = "fake"

    def __init__(self):
        self.turned = []
        self.closed = False

    def open(self):
        pass

    def turn(self, angle):
        self.turned.append(angle)

    def close(self):
        self.closed = True


class Standing:
    """Sees someone who stands `bearing` degrees round from where the camera rests, wherever that is in
    the image of a camera turned as `follower` says: the room, seen through a camera that turns."""

    name = "standing"

    def __init__(self, follower, bearing, fov=60):
        self.follower, self.bearing, self.fov = follower, bearing, fov

    def detect(self, image):
        if self.bearing is None:
            return []
        off_axis = self.bearing - self.follower.angle
        if abs(off_axis) > self.fov / 2:
            return []
        return [person(0.5 + math.tan(math.radians(off_axis)) / (2 * math.tan(math.radians(self.fov / 2))))]


def make_turning(posted, clock, bearing, **options):
    source, follower, drive = FakeSource(), PanFollower(), FakeDrive()
    room = Standing(follower, bearing)
    return source, room, drive, make_vision(source, room, posted, clock, pan=(follower, drive), **options)


def test_the_camera_turns_to_the_person_followed_and_the_alerts_say_how_far(clock, posted):
    source, room, drive, vision = make_turning(posted, clock, bearing=20.0)
    for _ in range(30):
        frame_at(vision, source, clock)
    # Within its deadband of them, and never faster than its 60 degrees a second.
    assert 16 <= drive.turned[-1] <= 20
    assert all(later - earlier <= 6 + 1e-9 for earlier, later in zip(drive.turned, drive.turned[1:]))
    assert {a["state"] for a in posted} == {"raised"} and len({a["alert_id"] for a in posted}) == 1
    first, last = posted[0]["detail"], posted[-1]["detail"]
    assert (first["pan"], first["x_norm"]) == (0.0, pytest.approx(0.815, abs=1e-3))
    assert last["pan"] == pytest.approx(drive.turned[-1], abs=0.05)
    assert abs(last["x_norm"] - 0.5) < 0.07
    assert first["id"] == last["id"]


def test_the_camera_does_not_turn_for_a_first_sighting(clock, posted):
    source, room, drive, vision = make_turning(posted, clock, bearing=20.0)
    frame_at(vision, source, clock)
    room.bearing = None
    for _ in range(10):
        frame_at(vision, source, clock)
    assert posted == [] and set(drive.turned) == {0.0}


def test_the_camera_waits_where_it_lost_them_then_goes_back_to_rest_once_the_intrusion_is_cleared(clock, posted):
    source, room, drive, vision = make_turning(posted, clock, bearing=-25.0)
    for _ in range(30):
        frame_at(vision, source, clock)
    lost_at = drive.turned[-1]
    assert -25 <= lost_at <= -21
    room.bearing = None
    for _ in range(29):
        frame_at(vision, source, clock)
    assert drive.turned[-1] == lost_at and posted[-1]["state"] == "raised"
    frame_at(vision, source, clock)
    assert posted[-1]["state"] == "cleared" and posted[-1]["detail"]["pan"] == pytest.approx(lost_at, abs=0.05)
    # Back at 30 degrees a second: half the way after 0.4 s, there within the second.
    for _ in range(4):
        frame_at(vision, source, clock)
    assert lost_at < drive.turned[-1] < 0
    for _ in range(8):
        frame_at(vision, source, clock)
    assert drive.turned[-1] == 0


def test_health_and_the_feed_say_how_far_the_camera_is_turned(clock, posted):
    source, room, drive, vision = make_turning(posted, clock, bearing=20.0)
    assert vision.health()["pan"] == 0.0
    for _ in range(30):
        frame_at(vision, source, clock)
    assert vision.health()["pan"] == pytest.approx(drive.turned[-1], abs=0.05)
    assert vision.jpeg()[1][:2] == b"\xff\xd8"


def test_finish_parks_the_camera_where_it_rests_and_lets_the_servo_go(clock, posted):
    source, room, drive, vision = make_turning(posted, clock, bearing=30.0)
    for _ in range(30):
        frame_at(vision, source, clock)
    turned, before = drive.turned[-1], len(drive.turned)
    waits = []
    vision.finish(sleep=waits.append)
    parked = drive.turned[before:]
    assert parked[-1] == 0 and drive.closed
    assert all(abs(later - earlier) <= 3 + 1e-9 for earlier, later in zip([turned, *parked], parked))
    assert waits == [0.05] * len(parked)
    assert posted[-1]["state"] == "cleared"


class FakeApi:
    """POST /api/v1/alerts on 127.0.0.1, answering 202 like the api."""

    def __init__(self):
        self.requests = []
        self.received = threading.Condition()
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                with api.received:
                    api.requests.append((self.path, self.headers["Authorization"], body))
                    api.received.notify_all()
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/v1/alerts"
        threading.Thread(target=self.server.serve_forever, args=(0.01,), daemon=True).start()

    def wait_for(self, count):
        with self.received:
            assert self.received.wait_for(lambda: len(self.requests) >= count, timeout=2)


def test_the_alerts_reach_the_api_with_the_vision_token(clock):
    api = FakeApi()
    try:
        source = FakeSource()
        with AlertClient(api.url, TOKEN) as alerts:
            vision = Vision(source, FakeDetector([person(0.25)], [person(0.25)]), alerts.post, clock=clock)
            for _ in range(2):
                frame_at(vision, source, clock)
            vision.finish()
        api.wait_for(2)
        assert [(path, auth) for path, auth, _ in api.requests] == [("/api/v1/alerts", f"Bearer {TOKEN}")] * 2
        bodies = [body for _, _, body in api.requests]
        assert [b["state"] for b in bodies] == ["raised", "cleared"]
        assert all(alert_errors(b) == [] for b in bodies)
        assert bodies[0]["detail"] == {
            "x_norm": 0.25,
            "confidence": 0.9,
            "bbox": [130, 80, 60, 180],
            "id": 1,
            "h_norm": 0.375,
            "pan": 0.0,
            "others": [],
        }
    finally:
        api.server.shutdown()
        api.server.server_close()


# --- the HTTP server ----------------------------------------------------------------------------------


@pytest.fixture
def served():
    """A Vision on a FakeSource, and its StreamServer on a free port of 127.0.0.1."""
    servers = []

    def serve(source=None, detector=None, **options):
        source = source or FakeSource()
        vision = Vision(source, detector or FakeDetector(), lambda alert: None)
        server = StreamServer(vision, "127.0.0.1", 0, **options)
        server.start()
        servers.append(server)
        return source, vision, server

    yield serve
    for server in servers:
        server.close()


def get(server, path):
    connection = http.client.HTTPConnection("127.0.0.1", server.port, timeout=5)
    connection.request("GET", path)
    return connection, connection.getresponse()


def parts(response, count):
    """The next `count` JPEGs of an MJPEG response, decoded."""
    images = []
    while len(images) < count:
        assert response.fp.readline() == b"--frame\r\n"
        headers = {}
        while (line := response.fp.readline()) != b"\r\n":
            name, _, value = line.decode().partition(":")
            headers[name.lower()] = value.strip()
        assert headers["content-type"] == "image/jpeg"
        data = response.fp.read(int(headers["content-length"]))
        assert response.fp.read(2) == b"\r\n"
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        assert image is not None
        images.append(image)
    return images


def wait_until(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def test_the_root_streams_the_annotated_frames_as_mjpeg(served):
    source, vision, server = served(detector=FakeDetector([person(0.5)]))
    source.show()
    vision.step()
    # The dashboard asks for /camera?attempt=N, which the proxy turns into /?attempt=N.
    connection, response = get(server, "/?attempt=3")
    assert response.status == 200
    assert response.getheader("Content-Type") == "multipart/x-mixed-replace; boundary=frame"
    assert response.getheader("Cache-Control") == "no-store"
    (first,) = parts(response, 1)
    assert first.shape == (HEIGHT, WIDTH, 3)
    # The box is drawn in red around the person (x 290..350): the grey frame is no longer grey there.
    assert first[170, 290][2] > 150 and abs(int(first[300, 100][2]) - 90) < 20
    # A new frame, a new part.
    source.show(np.full((HEIGHT, WIDTH, 3), 200, np.uint8))
    vision.step()
    (second,) = parts(response, 1)
    assert abs(int(second[300, 100][0]) - 200) < 20
    connection.close()


def test_the_stream_is_paced_and_sends_each_picture_once(served):
    source, vision, server = served(fps=5)
    source.show()
    vision.step()
    connection, response = get(server, "/")
    parts(response, 1)
    started = time.monotonic()
    for value in (40, 80, 120):
        source.show(np.full((HEIGHT, WIDTH, 3), value, np.uint8))
        vision.step()
        (image,) = parts(response, 1)
        assert abs(int(image[300, 100][0]) - value) < 20
    # 5 pictures a second at most.
    assert time.monotonic() - started >= 0.5
    connection.close()


def test_a_camera_down_streams_a_card_saying_so(served):
    source, vision, server = served()
    source.ok = False
    connection, response = get(server, "/")
    assert response.status == 200
    # Two parts, a second apart: the card is sent again, so a client that left is noticed.
    first, second = parts(response, 2)
    assert first.shape == (HEIGHT, WIDTH, 3) and abs(int(first[300, 100][0]) - 32) < 10
    connection.close()


def test_clients_beyond_the_cap_get_a_503_and_a_freed_slot_is_reused(served):
    source, vision, server = served(max_clients=1)
    source.show()
    vision.step()
    first, response = get(server, "/")
    parts(response, 1)
    second, refused = get(server, "/")
    assert refused.status == 503
    assert "clients" in json.loads(refused.read())["error"]
    second.close()
    # Both: the response holds the socket too.
    response.close()
    first.close()
    # The server notices the client left when a write fails: a frame or two after.
    def gone():
        source.show()
        vision.step()
        return server.clients == 0

    wait_until(gone)
    third, response = get(server, "/")
    assert response.status == 200
    parts(response, 1)
    third.close()


def test_health_is_200_while_the_camera_works_503_once_down(served):
    source, vision, server = served()
    source.show()
    vision.step()
    connection, response = get(server, "/health")
    assert response.status == 200
    assert response.getheader("Content-Type") == "application/json"
    assert json.loads(response.read()) == {"camera": "ok", "fps": 0.0, "inference_ms": pytest.approx(0, abs=50), "clients": 0, "detector": "fake"}
    connection.close()
    source.ok = False
    connection, response = get(server, "/health")
    assert response.status == 503
    assert json.loads(response.read())["camera"] == "down"
    connection.close()


def test_health_counts_the_clients_watching(served):
    source, vision, server = served()
    source.show()
    vision.step()
    stream, response = get(server, "/")
    parts(response, 1)
    connection, health = get(server, "/health?x=1")
    assert json.loads(health.read())["clients"] == 1
    connection.close()
    stream.close()


@pytest.mark.parametrize("path", ["/camera", "/health/x", "/favicon.ico"])
def test_nothing_else_is_served(served, path):
    _, _, server = served()
    connection, response = get(server, path)
    assert response.status == 404
    connection.close()


# --- the configuration --------------------------------------------------------------------------------


@pytest.fixture
def env(monkeypatch):
    for name in ("CAMERA_SOURCE", "DETECTOR", "INFER_EVERY", "ALERTS_URL", "VISION_SENTINEL", "CLEAR_AFTER_S",
                 "MIN_CONFIDENCE", "HTTP_HOST", "HTTP_PORT", "STREAM_FPS", "MAX_CLIENTS", "JPEG_QUALITY",
                 "CAMERA_FOV_DEG", "PAN_DRIVE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VISION_TOKEN", TOKEN)
    return monkeypatch


def test_settings_default_to_the_compose_stack(env):
    settings = load_settings()
    assert settings.camera_source == "opencv:0" and settings.detector == "motion"
    assert settings.alerts_url == "http://api:8080/api/v1/alerts" and settings.token == TOKEN
    assert (settings.http_host, settings.http_port) == ("0.0.0.0", 8000)
    assert (settings.infer_every, settings.stream_fps, settings.max_clients) == (1, 15, 4)
    assert (settings.sentinel, settings.clear_after, settings.min_confidence) == ("sentinel-01", 3.0, 0.5)
    # A fixed camera, with the field of view the Twin draws.
    assert (settings.pan_drive, settings.camera_fov) == ("none", 60)
    assert TOKEN not in repr(settings)


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("DETECTOR", "yolo", "DETECTOR: expected one of tflite, motion"),
        ("STREAM_FPS", "30", "STREAM_FPS: expected a number >= 1 and <= 15"),
        ("INFER_EVERY", "0", "INFER_EVERY"),
        ("VISION_TOKEN", "short", "VISION_TOKEN: too short"),
        ("PAN_DRIVE", "dc-motor", "PAN_DRIVE: expected one of none, pwm, stepper"),
        ("CAMERA_FOV_DEG", "200", "CAMERA_FOV_DEG"),
    ],
)
def test_a_bad_setting_is_named(env, name, value, message):
    env.setenv(name, value)
    with pytest.raises(ConfigError, match=message):
        load_settings()


def test_a_camera_that_turns_needs_a_person_detector(env):
    env.setenv("PAN_DRIVE", "pwm")
    with pytest.raises(ConfigError, match="PAN_DRIVE: a camera that turns needs a person detector"):
        load_settings()
    env.setenv("DETECTOR", "tflite")
    assert load_settings().pan_drive == "pwm"
