import cv2
import numpy as np
import pytest

from sentinel_common.config import ConfigError
from vision.detectors import MotionDetector, make_detector

WIDTH, HEIGHT = 640, 480


class Scene:
    """A still, textured background with sensor noise, and a 60x150 "person" wherever we put it."""

    def __init__(self, seed: int = 0):
        rng = np.random.default_rng(seed)
        texture = rng.integers(60, 120, (HEIGHT, WIDTH, 1)) * np.ones((1, 1, 3))
        background = cv2.GaussianBlur(texture.astype(np.uint8), (7, 7), 0)
        # A few noisy takes, played in turn: drawing fresh noise for every frame would be most of the test.
        noisy = (background + rng.normal(0, 3, background.shape) for _ in range(8))
        self.takes = [np.clip(take, 0, 255).astype(np.uint8) for take in noisy]
        self.count = 0

    def frame(self, x: int | None = None) -> np.ndarray:
        self.count += 1
        image = self.takes[self.count % len(self.takes)].copy()
        if x is not None:
            cv2.rectangle(image, (x, 200), (x + 59, 349), (200, 180, 160), -1)
        return image


def test_a_rectangle_moving_across_is_found_where_it_is():
    scene, detector = Scene(), MotionDetector()
    for _ in range(30):
        assert detector.detect(scene.frame()) == []
    for x in range(40, 560, 8):
        detections = detector.detect(scene.frame(x))
        assert len(detections) == 1, x
        d = detections[0]
        assert (d.x + d.w / 2) / WIDTH == pytest.approx((x + 30) / WIDTH, abs=0.01)
        # The box holds the rectangle, give or take the blur and the closing.
        assert d.x <= x + 2 and d.x + d.w >= x + 58
        assert d.y <= 202 and d.y + d.h >= 348
        assert 0.5 <= d.confidence <= 1


def test_a_still_scene_gives_nothing_once_learnt():
    scene, detector = Scene(seed=1), MotionDetector()
    assert [detector.detect(scene.frame()) for _ in range(100)] == [[]] * 100


def test_nothing_during_the_warm_up_even_with_movement():
    scene, detector = Scene(seed=2), MotionDetector(warmup=10)
    assert [detector.detect(scene.frame(40 + 10 * i)) for i in range(10)] == [[]] * 10


def test_confidence_grows_with_the_blob_and_small_ones_are_ignored():
    scene, detector = Scene(seed=3), MotionDetector()
    for _ in range(30):
        detector.detect(scene.frame())
    # A 20x20 square: 0.13 % of the frame, under min_area.
    image = scene.frame()
    cv2.rectangle(image, (300, 300), (319, 319), (220, 220, 220), -1)
    assert detector.detect(image) == []
    # A quarter of the frame: more than a person, capped at 1.
    image = scene.frame()
    cv2.rectangle(image, (0, 0), (319, 239), (220, 220, 220), -1)
    assert [d.confidence for d in detector.detect(image)] == [1.0]


def test_the_largest_blobs_come_first():
    scene, detector = Scene(seed=4), MotionDetector()
    for _ in range(30):
        detector.detect(scene.frame())
    image = scene.frame()
    cv2.rectangle(image, (40, 100), (99, 249), (220, 220, 220), -1)
    cv2.rectangle(image, (400, 100), (499, 349), (220, 220, 220), -1)
    detections = detector.detect(image)
    assert len(detections) == 2
    assert detections[0].x > 380 and detections[0].confidence > detections[1].confidence


def test_the_registry_names_the_detectors():
    assert make_detector("motion").name == "motion"
    with pytest.raises(ConfigError, match="DETECTOR: expected one of motion, got 'yolo'"):
        make_detector("yolo")
