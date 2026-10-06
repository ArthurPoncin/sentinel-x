import threading
import time

import cv2
import numpy as np
import pytest

from sentinel_common.config import ConfigError
from vision.sources import CaptureThread, OpenCVSource, fit, make_source

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
    with pytest.raises(ConfigError, match="CAMERA_SOURCE: expected opencv:<webcam index>"):
        make_source("opencv:")
    with pytest.raises(ConfigError, match="CAMERA_SOURCE: expected one of opencv:…, got 'usb:0'"):
        make_source("usb:0")
