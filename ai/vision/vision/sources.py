"""Where the frames come from: `CAMERA_SOURCE`, `picamera2` (the Pi's ZIF camera), `opencv:<index>` (a webcam)
or `opencv:<path>` (a video file, played in a loop). Each is a `CaptureThread` and a line in `SOURCES`.

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
# The ZIF camera's rate: the feed's own ceiling (STREAM_FPS), and more than detection keeps up with.
_PICAMERA_FPS = 15.0
# A ZIF camera with no frame for this long is lost, not a capture thread stuck in its read for good.
_PICAMERA_TIMEOUT = 2.0


@dataclass(frozen=True)
class Frame:
    """A captured image: BGR, at most 640x480. Shared with every reader: draw on a copy."""

    image: np.ndarray
    index: int  # 1, 2, 3…: a new index is a new image
    at: float  # monotonic time of its capture
    capture_ms: float = 0.0  # how long reading and shrinking it took: what `python -m vision.bench` reports


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
    all called from the capture thread), and, if it is not the camera that sets the pace, how long to wait
    before the next image (`_wait_next`). Connecting again waits `retry` seconds, doubling up to
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

    def _wait_next(self) -> bool:
        """Waits until the next image is due; False when stopping. Not timed as capture. A camera's own
        read waits for its next frame: nothing to wait here."""
        return not self._stop.is_set()

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
                while self._wait_next():
                    started = time.perf_counter()
                    image = self._grab()
                    if image is None:
                        # Once, not on every reconnection that gives nothing either.
                        if not self._stop.is_set() and problem != "lost":
                            problem = "lost"
                            logger.warning("Camera %s lost: reconnecting", self.name)
                        break
                    self._publish(image, started)
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

    def _publish(self, image: np.ndarray, started: float) -> None:
        image = fit(image)
        height, width = image.shape[:2]
        # The tracker's pixels are those of the first frame: a camera that comes back at another size is
        # scaled to it, so a box always means the same place.
        if self._size is None:
            self._size = (width, height)
        elif self._size != (width, height):
            image = cv2.resize(image, self._size, interpolation=cv2.INTER_AREA)
        capture_ms = (time.perf_counter() - started) * 1000
        with self._lock:
            index = self._frame.index + 1 if self._frame else 1
            self._frame = Frame(image, index, time.monotonic(), capture_ms)


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

    def _wait_next(self) -> bool:
        # A webcam's read waits for its next frame: it sets the pace. A file reads as fast as it decodes:
        # played at its own frame rate, like a camera.
        if self._path is None:
            return not self._stop.is_set()
        return not self._stop.wait(max(0.0, self._due - time.monotonic()))

    def _grab(self) -> np.ndarray | None:
        capture = self._capture
        assert capture is not None
        if self._path is None:
            ok, image = capture.read()
            return image if ok else None
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


class Picamera2Source(CaptureThread):
    """`picamera2`: the Pi's ZIF camera on its CSI port, through libcamera — OpenCV cannot read its raw node.
    640x480 at 15 frames a second, the sensor's whole field binned down. Picamera2 is imported when the source
    connects: only the Pi's image carries it (ai/vision/Dockerfile), and libcamera reaches the camera through
    the device nodes of docker-compose.camera.yml."""

    def __init__(self, target: str, **options: float) -> None:
        if target:
            raise ValueError("expected picamera2, with nothing after it")
        super().__init__("picamera2", **options)
        self._camera = None

    def _connect(self) -> None:
        try:
            from picamera2 import Picamera2
        except ImportError:
            raise OSError("Picamera2 is not installed: only the Pi's image has it") from None
        # Picamera2() itself would only say "list index out of range".
        if not Picamera2.global_camera_info():
            raise OSError("libcamera sees no camera: rpicam-hello --list-cameras on the Pi, then docker-compose.camera.yml")
        camera = Picamera2()
        try:
            camera.configure(
                camera.create_video_configuration(
                    # RGB888 is Picamera2's name for bytes in [B, G, R] order: OpenCV's, nothing to convert.
                    main={"size": (MAX_WIDTH, MAX_HEIGHT), "format": "RGB888"},
                    controls={"FrameRate": _PICAMERA_FPS},
                )
            )
            camera.start()
        except Exception:
            camera.close()
            raise
        self._camera = camera

    def _grab(self) -> np.ndarray | None:
        camera = self._camera
        assert camera is not None
        # Asked without waiting, then waited on with a limit: Picamera2's own wait has none.
        job = camera.capture_array("main", wait=False)
        try:
            return camera.wait(job, timeout=_PICAMERA_TIMEOUT)
        except TimeoutError:
            # Picamera2's advice for a camera that stopped answering (its ribbon loose): drop what waits on
            # it, so that closing it does not wait too.
            camera.cancel_all_and_flush()
            return None

    def _disconnect(self) -> None:
        camera, self._camera = self._camera, None
        if camera is not None:
            # Stops it first if it runs, and lets the camera go for the next connection.
            camera.close()


# CAMERA_SOURCE `<kind>:<argument>` → the source; the factory gets the argument ("" when there is none).
SOURCES: dict[str, Callable[[str], FrameSource]] = {
    "opencv": OpenCVSource,
    "picamera2": Picamera2Source,
}


def make_source(spec: str) -> FrameSource:
    """The source CAMERA_SOURCE names. A ConfigError when it names none."""
    kind, _, argument = spec.partition(":")
    factory = SOURCES.get(kind)
    if factory is None:
        raise ConfigError(f"CAMERA_SOURCE: expected one of {', '.join(SOURCES)}, got {spec!r}")
    try:
        return factory(argument)
    except ValueError as error:
        raise ConfigError(f"CAMERA_SOURCE: {error}, got {spec!r}") from None
