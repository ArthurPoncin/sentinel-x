"""What finds the intruder in a frame: `DETECTOR`, `motion` here (OpenCV background subtraction, the
fallback the brief allows). The TFLite person detector plugs in the same way: a class with `detect()` and
a line in `DETECTORS`.
"""

from typing import Callable, Protocol

import cv2
import numpy as np

from sentinel_common.config import ConfigError

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
        self._max_blobs, self._warmup = max_blobs, warmup
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
        rate = -1 if self._seen <= self._warmup else self._rate
        mask = self._subtractor.apply(cv2.GaussianBlur(image, (5, 5), 0), learningRate=rate)
        if self._seen <= self._warmup:
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


# DETECTOR → a factory that reads its own settings, if it has any.
DETECTORS: dict[str, Callable[[], Detector]] = {
    "motion": MotionDetector,
}


def make_detector(name: str) -> Detector:
    """The detector DETECTOR names. A ConfigError when it names none."""
    factory = DETECTORS.get(name)
    if factory is None:
        raise ConfigError(f"DETECTOR: expected one of {', '.join(DETECTORS)}, got {name!r}")
    return factory()
