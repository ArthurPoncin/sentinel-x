"""What finds the intruder in a frame: `DETECTOR`, `tflite` (EfficientDet-Lite0, a person detector, in
`vision.tflite`) or `motion` (OpenCV background subtraction, the fallback the brief allows). Another one
plugs in the same way: a class with `detect()` and a line in `DETECTORS`.

`MOTION_GATE=true` puts the motion detector in front of the person detector: the model runs only when
something moves, the Pi's CPU rests while the scene is still.
"""

import time
from typing import Callable, Protocol

import cv2
import numpy as np

from sentinel_common.config import ConfigError, env_bool, env_float

from .tracker import Detection


class Detector(Protocol):
    name: str

    def detect(self, image: np.ndarray) -> list[Detection]:
        """The people in a BGR frame, boxes in its pixels; empty when there is nobody. Called on the
        inference thread only, one frame after another."""


class MotionDetector:
    """Whatever moves against the background, as a person would: OpenCV's MOG2 background model learns
    the still scene, the pixels that differ from it make blobs, the largest ones are the detections.

    - shadows, which MOG2 marks apart, are left out, and so are specks (an opening) and blobs smaller than
      `min_area` of the frame; the rest is closed up so that a person makes one blob, not a head and legs;
    - `confidence` grows with the blob's area: `area / person_area` of the frame, capped at 1. A blob the
      size of a person at the fence (`person_area`, 4 % of the frame) or more is 1; half of it, 0.5, which
      `MIN_CONFIDENCE`'s default of 0.5 still lets through;
    - the first `warmup` frames give nothing: the background is being learnt, fast. Then it keeps learning
      at a steady 1/`history` a frame, so that someone who walks in is not learnt in a few frames;
    - the work is done at `work_width` pixels wide (320, a quarter of the pixels of 640x480: several times
      faster on the Pi), the boxes scaled back to the frame.

    What stops moving fades into the background in a few seconds (about `history` inferences): motion
    only says someone moves, the person detector that someone is there.
    """

    name = "motion"

    def __init__(
        self,
        *,
        history: int = 200,
        var_threshold: float = 32.0,
        min_area: float = 0.005,
        person_area: float = 0.04,
        max_blobs: int = 3,
        warmup: int = 20,
        work_width: int = 320,
    ) -> None:
        self._subtractor = cv2.createBackgroundSubtractorMOG2(history=history, varThreshold=var_threshold, detectShadows=True)
        self._rate = 1 / history
        self._min_area, self._person_area = min_area, person_area
        self._max_blobs, self.warmup = max_blobs, warmup
        self._work_width = work_width
        self._seen = 0
        self._open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self._close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))

    def detect(self, image: np.ndarray) -> list[Detection]:
        height, width = image.shape[:2]
        scale = min(1.0, self._work_width / width)
        if scale < 1:
            image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        # A little blur first: sensor noise would otherwise flicker in and out of the foreground.
        self._seen += 1
        # -1: OpenCV's own rate, 1/(frames seen so far), while warming up.
        rate = -1 if self._seen <= self.warmup else self._rate
        mask = self._subtractor.apply(cv2.GaussianBlur(image, (5, 5), 0), learningRate=rate)
        if self._seen <= self.warmup:
            return []
        # MOG2 marks shadows 127, movement 255.
        _, mask = cv2.threshold(mask, 254, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._open)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._close)
        # [-2]: OpenCV 3 returned three values, 4 and later two.
        contours = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
        frame_area = image.shape[0] * image.shape[1]
        blobs = sorted(((cv2.contourArea(c), c) for c in contours), key=lambda blob: blob[0], reverse=True)
        detections = []
        for area, contour in blobs[: self._max_blobs]:
            if area < self._min_area * frame_area:
                break
            x, y, w, h = (value / scale for value in cv2.boundingRect(contour))
            confidence = min(1.0, area / (self._person_area * frame_area))
            detections.append(Detection(x, y, w, h, round(confidence, 3)))
        return detections


class MotionGate:
    """A person detector that runs only while something moves, or just moved, or was a person just now.

    The motion detector sees every frame (its background must keep learning); the person detector runs
    while the gate is open, and the gate stays open `hold` seconds after the last movement *or the last
    person seen*. That second half is what keeps someone who stands still tracked: motion lets them fade
    into the background within seconds, the person detector keeps seeing them, and each sighting holds the
    gate open again. Once nobody moves and nobody is seen for `hold` seconds, the model rests.

    The gate starts open, for the motion detector's `warmup` frames and `hold` seconds more: it reports
    nothing while it learns the scene, and someone already standing there at start must still be seen.
    """

    def __init__(
        self,
        detector: Detector,
        motion: Detector,
        *,
        hold: float = 3.0,
        warmup: int = 0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.inner, self._motion, self._hold, self._clock = detector, motion, hold, clock
        self.name = f"{detector.name}+motion"
        self._warmup, self._seen = warmup, 0
        self._open_until: float | None = None
        # How many frames the person detector ran on, for the benchmark: the share of frames that cost a
        # model inference.
        self.runs = 0

    def detect(self, image: np.ndarray) -> list[Detection]:
        now = self._clock()
        self._seen += 1
        if self._open_until is None or self._seen <= self._warmup:
            self._open_until = now + self._hold
        if self._motion.detect(image):
            self._open_until = max(self._open_until, now + self._hold)
        if now >= self._open_until:
            return []
        self.runs += 1
        people = self.inner.detect(image)
        if people:
            self._open_until = max(self._open_until, now + self._hold)
        return people


def env_min_confidence() -> float:
    """MIN_CONFIDENCE: under it, a detection is nobody. Read by the service, which drops what is under it
    whatever the detector, and by the detectors that filter on their own, so that both agree."""
    return env_float("MIN_CONFIDENCE", 0.5, min=0, max=1)


def _tflite() -> Detector:
    # Imported here: the TFLite runtime is only needed when it is asked for.
    from .tflite import TFLiteDetector

    return TFLiteDetector.from_env(min_score=env_min_confidence())


# DETECTOR → a factory that reads its own settings, if it has any.
DETECTORS: dict[str, Callable[[], Detector]] = {
    "tflite": _tflite,
    "motion": MotionDetector,
}


def make_detector(name: str) -> Detector:
    """The detector DETECTOR names, behind the motion gate when MOTION_GATE says so (MOTION_GATE_HOLD_S,
    3 s by default, like CLEAR_AFTER_S). A ConfigError when it names none, or gates the motion detector
    behind itself."""
    factory = DETECTORS.get(name)
    if factory is None:
        raise ConfigError(f"DETECTOR: expected one of {', '.join(DETECTORS)}, got {name!r}")
    gate = env_bool("MOTION_GATE", False)
    hold = env_float("MOTION_GATE_HOLD_S", 3.0, min=0.5, max=60)
    if gate and name == "motion":
        raise ConfigError("MOTION_GATE: gates a person detector behind the motion one, so not DETECTOR=motion")
    detector = factory()
    if not gate:
        return detector
    motion = MotionDetector()
    return MotionGate(detector, motion, hold=hold, warmup=motion.warmup)
