"""Where the frames come from: `CAMERA_SOURCE`, `opencv:<index>` (a webcam) or `opencv:<path>` (a video file,
played in a loop). The Pi's ZIF camera (Picamera2) plugs in the same way: a `CaptureThread` and a line in
`SOURCES`.

A capture thread keeps only the latest frame: inference always works on what the camera sees now, never on
a queue that falls behind. A camera that is absent or lost stops nothing: the source says it is down and
opens it again on its own, waiting longer each time.
"""

import logging
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable, Protocol

import cv2
import numpy as np

from sentinel_common.config import ConfigError

logger = logging.getLogger(__name__)

# The README's budget on the Pi 4: inference stays near 100 ms a frame at this size.
MAX_WIDTH, MAX_HEIGHT = 640, 480
# A video file that does not say its frame rate plays at this one.
_DEFAULT_FPS = 25.0


@dataclass(frozen=True)
class Frame:
    """A captured image: BGR, at most 640x480. Shared with every reader: draw on a copy."""

    image: np.ndarray
    index: int  # 1, 2, 3…: a new index is a new image
    at: float  # monotonic time of its capture


class FrameSource(Protocol):
    """A camera. `open()` and `read()` never raise because the camera is missing: `ok` says so."""

    def open(self) -> None:
        """Starts capturing in the background, and keeps trying while the camera is not there."""

    def read(self) -> Frame | None:
        """The latest frame, at once: the same one again until the next is captured, None before the first."""

    def close(self) -> None:
        """Stops capturing and lets the camera go."""

    @property
    def ok(self) -> bool:
        """A frame came in recently: the camera works."""

    @property
    def width(self) -> int | None:
        """The frames' width in pixels, None before the first one."""

    @property
    def height(self) -> int | None:
        """The frames' height in pixels, None before the first one."""


def fit(image: np.ndarray) -> np.ndarray:
    """The image shrunk to fit 640x480, its proportions kept; as is when it already fits."""
    height, width = image.shape[:2]
    scale = min(MAX_WIDTH / width, MAX_HEIGHT / height)
    if scale >= 1:
        return image
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return cv2.resize(image, size, interpolation=cv2.INTER_AREA)


class CaptureThread:
    """The part every camera shares: the capture thread, the latest frame, the retries.

    A camera only says how to connect, grab one image and disconnect (`_connect`, `_grab`, `_disconnect`,
    all called from the capture thread). Connecting again waits `retry` seconds, doubling up to
    `max_retry`, back to `retry` once a frame came in. The camera is `ok` while its last frame is less than
    `stale_after` seconds old: a camera stuck in a read is down too, though nothing raised.
    """

    def __init__(self, name: str, *, retry: float = 0.5, max_retry: float = 10.0, stale_after: float = 2.0) -> None:
        self.name = name
        self._retry, self._max_retry, self._stale_after = retry, max_retry, stale_after
        self._lock = threading.Lock()
        self._frame: Frame | None = None
        self._size: tuple[int, int] | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.name!r})"

    def open(self) -> None:
        if self._thread is None:
            # A daemon: a read the camera never answers cannot hold the service at exit.
            self._thread = threading.Thread(target=self._run, name="capture", daemon=True)
            self._thread.start()

    def read(self) -> Frame | None:
        with self._lock:
            return self._frame

    def close(self, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)

    @property
    def ok(self) -> bool:
        frame = self.read()
        return frame is not None and time.monotonic() - frame.at < self._stale_after

    @property
    def width(self) -> int | None:
        return self._size[0] if self._size else None

    @property
    def height(self) -> int | None:
        return self._size[1] if self._size else None

    def _connect(self) -> None:
        """Opens the camera; raises when it cannot."""
        raise NotImplementedError

    def _grab(self) -> np.ndarray | None:
        """The next BGR image, None when the camera is lost."""
        raise NotImplementedError

    def _disconnect(self) -> None:
        raise NotImplementedError

    def _run(self) -> None:
        delay, problem = self._retry, None
        while not self._stop.is_set():
            try:
                self._connect()
            except Exception as error:
                # Logged when the reason changes, not on every retry of a camera left unplugged.
                if str(error) != problem:
                    problem = str(error)
                    logger.warning("Camera %s unavailable (%s): retrying, every %g s at most", self.name, error, self._max_retry)
                self._stop.wait(delay)
                delay = min(delay * 2, self._max_retry)
                continue
            first = True
            try:
                while not self._stop.is_set():
                    image = self._grab()
                    if image is None:
                        # Once, not on every reconnection that gives nothing either.
                        if not self._stop.is_set() and problem != "lost":
                            problem = "lost"
                            logger.warning("Camera %s lost: reconnecting", self.name)
                        break
                    self._publish(image)
                    if first:
                        first, delay, problem = False, self._retry, None
                        logger.info("Camera %s up, %dx%d", self.name, self.width, self.height)
            except Exception as error:
                problem = str(error)
                logger.exception("Camera %s failed: reconnecting", self.name)
            finally:
                try:
                    self._disconnect()
                except Exception:
                    logger.exception("Camera %s: could not be released", self.name)
            self._stop.wait(delay)
            delay = min(delay * 2, self._max_retry)

    def _publish(self, image: np.ndarray) -> None:
        image = fit(image)
        height, width = image.shape[:2]
        # The tracker's pixels are those of the first frame: a camera that comes back at another size is
        # scaled to it, so a box always means the same place.
        if self._size is None:
            self._size = (width, height)
        elif self._size != (width, height):
            image = cv2.resize(image, self._size, interpolation=cv2.INTER_AREA)
        with self._lock:
            index = self._frame.index + 1 if self._frame else 1
            self._frame = Frame(image, index, time.monotonic())


class OpenCVSource(CaptureThread):
    """`opencv:0` a webcam by its index, `opencv:/path/video.mp4` a video file played in a loop at its own
    frame rate: the camera of a laptop, or the same scene again and again for development and the tests.
    (OpenCV cannot read the Pi's CSI camera: that is Picamera2's job.)"""

    def __init__(self, target: str, **options: float) -> None:
        if not target:
            raise ValueError("expected opencv:<webcam index> or opencv:<path of a video file>")
        super().__init__(f"opencv:{target}", **options)
        self._index = int(target) if target.isdigit() else None
        self._path = None if self._index is not None else target
        self._capture: cv2.VideoCapture | None = None
        self._period = 0.0
        self._due = 0.0

    def _connect(self) -> None:
        if self._path is not None:
            # VideoCapture would only say it could not open it.
            if not os.path.isfile(self._path):
                raise FileNotFoundError(f"no file {self._path}")
            capture = cv2.VideoCapture(self._path)
        else:
            capture = cv2.VideoCapture(self._index)
            # Asked, not guaranteed: what comes larger is shrunk in _publish.
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, MAX_WIDTH)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, MAX_HEIGHT)
        if not capture.isOpened():
            capture.release()
            raise OSError("OpenCV cannot open it")
        self._capture = capture
        if self._path is not None:
            fps = capture.get(cv2.CAP_PROP_FPS)
            self._period = 1 / (fps if math.isfinite(fps) and 1 <= fps <= 120 else _DEFAULT_FPS)
            self._due = time.monotonic()

    def _grab(self) -> np.ndarray | None:
        capture = self._capture
        assert capture is not None
        if self._path is None:
            # A webcam's read waits for its next frame: it sets the pace.
            ok, image = capture.read()
            return image if ok else None
        # A file reads as fast as it decodes: played at its own frame rate, like a camera.
        if self._stop.wait(max(0.0, self._due - time.monotonic())):
            return None
        ok, image = capture.read()
        if not ok:
            # The end of the video: from the start again.
            capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, image = capture.read()
        # Late (a slow machine, a pause): carry on from now rather than rush to catch up.
        self._due = max(self._due + self._period, time.monotonic())
        return image if ok else None

    def _disconnect(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None


# CAMERA_SOURCE `<kind>:<argument>` → the source; the factory gets the argument ("" when there is none).
SOURCES: dict[str, Callable[[str], FrameSource]] = {
    "opencv": OpenCVSource,
}


def make_source(spec: str) -> FrameSource:
    """The source CAMERA_SOURCE names. A ConfigError when it names none."""
    kind, _, argument = spec.partition(":")
    factory = SOURCES.get(kind)
    if factory is None:
        raise ConfigError(f"CAMERA_SOURCE: expected one of {', '.join(f'{k}:…' for k in SOURCES)}, got {spec!r}")
    try:
        return factory(argument)
    except ValueError as error:
        raise ConfigError(f"CAMERA_SOURCE: {error}, got {spec!r}") from None
