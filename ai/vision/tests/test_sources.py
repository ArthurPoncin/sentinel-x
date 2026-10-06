import sys
import threading
import time
import types

import cv2
import numpy as np
import pytest

from sentinel_common.config import ConfigError
from vision.sources import CaptureThread, OpenCVSource, Picamera2Source, fit, make_source

# Tiny waits: the retries are under test, not their pace.
FAST = {"retry": 0.02, "max_retry": 0.05, "stale_after": 0.5}


def write_video(path, width, height, frames=10, fps=50.0):
    """A video whose frame i is uniformly grey at 20 * i: each frame tells where in the video it is."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (width, height))
    assert writer.isOpened()
    for i in range(frames):
        writer.write(np.full((height, width, 3), 20 * i, np.uint8))
    writer.release()
    return path


def wait_until(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


@pytest.fixture
def opened():
    sources = []

    def open_source(target, **options):
        source = OpenCVSource(str(target), **{**FAST, **options})
        sources.append(source)
        source.open()
        return source

    yield open_source
    for source in sources:
        source.close()


def test_a_video_file_plays_in_a_loop_keeping_only_the_latest_frame(tmp_path, opened):
    source = opened(write_video(tmp_path / "loop.avi", 160, 120))
    wait_until(lambda: source.read() is not None and source.read().index > 25)
    assert source.ok
    assert (source.width, source.height) == (160, 120)
    frame = source.read()
    assert frame.image.shape == (120, 160, 3)
    # Past the 10 frames of the file: it started over.
    levels = set()
    while len(levels) < 10:
        levels.add(round(float(source.read().image.mean()) / 20))
        time.sleep(0.005)
    assert levels == set(range(10))


def test_a_video_file_plays_at_its_own_frame_rate(tmp_path, opened):
    source = opened(write_video(tmp_path / "slow.avi", 64, 48, fps=10.0))
    wait_until(lambda: source.read() is not None)
    first = source.read().index
    time.sleep(0.55)
    # 10 frames a second: about 5 more, not the hundreds it could decode.
    assert 3 <= source.read().index - first <= 7


@pytest.mark.parametrize(("size", "expected"), [((800, 600), (640, 480)), ((1280, 480), (640, 240)), ((320, 240), (320, 240))])
def test_frames_larger_than_640x480_are_shrunk_keeping_proportions(tmp_path, opened, size, expected):
    source = opened(write_video(tmp_path / "big.avi", *size, frames=3))
    wait_until(lambda: source.read() is not None)
    assert source.read().image.shape[:2] == (expected[1], expected[0])
    assert (source.width, source.height) == expected


def test_fit():
    assert fit(np.zeros((960, 1280, 3), np.uint8)).shape == (480, 640, 3)
    assert fit(np.zeros((1080, 640, 3), np.uint8)).shape == (480, 284, 3)
    small = np.zeros((48, 64, 3), np.uint8)
    assert fit(small) is small


def test_a_missing_camera_is_down_without_crashing_and_comes_up_when_it_appears(tmp_path, opened):
    path = tmp_path / "later.avi"
    source = opened(path)
    time.sleep(0.2)
    assert source.read() is None and not source.ok
    assert (source.width, source.height) == (None, None)
    # Written elsewhere then moved in: the source must not catch a half-written file.
    write_video(tmp_path / "partial.avi", 64, 48).rename(path)
    wait_until(lambda: source.ok)
    assert source.read().image.shape == (48, 64, 3)


def test_an_absent_webcam_is_down_without_crashing(opened):
    source = opened(99)
    time.sleep(0.2)
    assert source.read() is None and not source.ok


class FlakyCamera(CaptureThread):
    """A camera that is not there at first, then gives `frames` frames, is lost, and comes back."""

    def __init__(self, frames=5, **options):
        super().__init__("flaky", **options)
        self.connects, self.disconnects, self.frames = 0, 0, frames
        self.given = 0
        self.lost = threading.Event()
        self.back = threading.Event()

    def _connect(self):
        self.connects += 1
        if self.connects == 1:
            raise OSError("not plugged in")
        if self.lost.is_set() and not self.back.is_set():
            raise OSError("unplugged")

    def _grab(self):
        time.sleep(0.01)
        if self.given == self.frames and not self.lost.is_set():
            self.lost.set()
            return None
        self.given += 1
        # A 1280x720 camera: shrunk like any other.
        return np.zeros((720, 1280, 3), np.uint8)

    def _disconnect(self):
        self.disconnects += 1


def test_a_camera_lost_goes_down_and_comes_back_alone():
    camera = FlakyCamera(**{**FAST, "stale_after": 0.1})
    camera.open()
    try:
        wait_until(lambda: camera.lost.is_set())
        assert camera.read().index == 5 and (camera.width, camera.height) == (640, 360)
        wait_until(lambda: not camera.ok)
        time.sleep(0.1)
        assert camera.read().index == 5
        camera.back.set()
        wait_until(lambda: camera.ok and camera.read().index > 5)
        # Each connection released once; the first one never opened.
        assert camera.connects >= 3 and camera.disconnects >= 1
    finally:
        camera.close()


def test_close_stops_capturing(tmp_path, opened):
    source = opened(write_video(tmp_path / "stop.avi", 64, 48))
    wait_until(lambda: source.read() is not None)
    source.close()
    index = source.read().index
    time.sleep(0.1)
    assert source.read().index == index


def test_camera_source_names_the_source():
    assert repr(make_source("opencv:0")) == "OpenCVSource('opencv:0')"
    assert repr(make_source("opencv:/videos/fence.mp4")) == "OpenCVSource('opencv:/videos/fence.mp4')"
    assert repr(make_source("picamera2")) == "Picamera2Source('picamera2')"
    with pytest.raises(ConfigError, match="CAMERA_SOURCE: expected opencv:<webcam index>"):
        make_source("opencv:")
    with pytest.raises(ConfigError, match="CAMERA_SOURCE: expected picamera2, with nothing after it, got 'picamera2:0'"):
        make_source("picamera2:0")
    with pytest.raises(ConfigError, match="CAMERA_SOURCE: expected one of opencv, picamera2, got 'usb:0'"):
        make_source("usb:0")


class FakePicamera2:
    """Picamera2 as Picamera2Source uses it, without a Pi: `cameras` is what libcamera sees, each frame is
    uniformly grey at its number, and `stalled` makes the camera stop answering."""

    cameras: list = []
    stalled = threading.Event()
    configure_fails = False
    opened: list = []

    @staticmethod
    def global_camera_info():
        return list(FakePicamera2.cameras)

    def __init__(self):
        self.config = None
        self.started = self.closed = self.flushed = False
        self.frames = 0
        FakePicamera2.opened.append(self)

    def create_video_configuration(self, main, controls):
        return {"main": main, "controls": controls}

    def configure(self, config):
        if FakePicamera2.configure_fails:
            raise RuntimeError("Failed to configure the camera")
        self.config = config

    def start(self):
        self.started = True

    def capture_array(self, name, wait):
        assert (name, wait) == ("main", False) and self.started and not self.closed
        return name

    def wait(self, job, timeout):
        if FakePicamera2.stalled.is_set():
            time.sleep(min(timeout, 0.05))
            raise TimeoutError
        time.sleep(0.01)
        self.frames += 1
        width, height = self.config["main"]["size"]
        return np.full((height, width, 3), self.frames % 256, np.uint8)

    def cancel_all_and_flush(self):
        self.flushed = True

    def close(self):
        self.closed = True


@pytest.fixture
def picamera2(monkeypatch):
    """The fake in place of the picamera2 module, reset for each test, and the sources opened to close."""
    module = types.ModuleType("picamera2")
    module.Picamera2 = FakePicamera2
    monkeypatch.setitem(sys.modules, "picamera2", module)
    FakePicamera2.cameras = [{"Model": "ov5647", "Num": 0}]
    FakePicamera2.stalled = threading.Event()
    FakePicamera2.configure_fails = False
    FakePicamera2.opened = []
    sources = []

    def open_source(**options):
        source = Picamera2Source("", **{**FAST, **options})
        sources.append(source)
        source.open()
        return source

    yield open_source
    for source in sources:
        source.close()


def test_the_zif_camera_gives_640x480_bgr_frames_at_15_a_second(picamera2):
    source = picamera2()
    wait_until(lambda: source.ok and source.read().index > 3)
    assert (source.width, source.height) == (640, 480)
    assert source.read().image.shape == (480, 640, 3)
    camera = FakePicamera2.opened[0]
    # RGB888: bytes in OpenCV's [B, G, R] order.
    assert camera.config == {"main": {"size": (640, 480), "format": "RGB888"}, "controls": {"FrameRate": 15.0}}


def test_no_zif_camera_is_down_without_crashing_and_comes_up_once_libcamera_sees_one(picamera2):
    FakePicamera2.cameras = []
    source = picamera2()
    time.sleep(0.2)
    assert source.read() is None and not source.ok
    # Never opened: Picamera2() would have failed on an empty list.
    assert FakePicamera2.opened == []
    FakePicamera2.cameras = [{"Model": "ov5647", "Num": 0}]
    wait_until(lambda: source.ok)


def test_a_zif_camera_that_stops_answering_is_lost_released_and_opened_again(picamera2):
    source = picamera2(stale_after=0.1)
    wait_until(lambda: source.ok)
    FakePicamera2.stalled.set()
    wait_until(lambda: not source.ok)
    first = FakePicamera2.opened[0]
    # Flushed before closing, as Picamera2 advises for a camera gone silent.
    wait_until(lambda: first.closed)
    assert first.flushed
    FakePicamera2.stalled.clear()
    wait_until(lambda: source.ok)
    assert len(FakePicamera2.opened) >= 2 and FakePicamera2.opened[-1].started


def test_a_zif_camera_that_cannot_be_configured_is_released(picamera2):
    FakePicamera2.configure_fails = True
    source = picamera2()
    wait_until(lambda: len(FakePicamera2.opened) >= 2)
    assert not source.ok
    assert all(camera.closed for camera in FakePicamera2.opened[:-1])


def test_without_picamera2_installed_the_zif_camera_is_down_without_crashing(monkeypatch):
    # None in sys.modules: `import picamera2` raises ImportError, as on a laptop's image.
    monkeypatch.setitem(sys.modules, "picamera2", None)
    source = Picamera2Source("", **FAST)
    source.open()
    try:
        time.sleep(0.2)
        assert source.read() is None and not source.ok
    finally:
        source.close()
