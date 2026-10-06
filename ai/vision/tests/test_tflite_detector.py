import os
import sys
import zipfile

import cv2
import numpy as np
import pytest

import fetch_model
from sentinel_common.config import ConfigError
from vision import tflite
from vision.detectors import DETECTORS, make_detector
from vision.tflite import TFLiteDetector, load_interpreter

WIDTH, HEIGHT = 640, 480
PERSON, CAR, DOG = 0, 2, 17


class FakeInterpreter:
    """A TFLite detection model whose outputs the test sets (`answer`), with its tensors listed in another
    order than their indices, as a converted model may list them. Keeps what it was given."""

    BOXES, CLASSES, SCORES, COUNT = 10, 11, 12, 13

    def __init__(self, size=(320, 320), dtype=np.uint8, outputs=None):
        self.input = {"index": 0, "shape": np.array([1, size[1], size[0], 3]), "dtype": dtype}
        self.outputs = outputs or [
            {"index": self.SCORES, "shape": np.array([1, 25])},
            {"index": self.COUNT, "shape": np.array([1])},
            {"index": self.BOXES, "shape": np.array([1, 25, 4])},
            {"index": self.CLASSES, "shape": np.array([1, 25])},
        ]
        self.tensors = {}
        self.given = None
        self.invoked = 0
        self.answer([])

    def answer(self, rows, count=None):
        """rows: (class, score, [ymin, xmin, ymax, xmax]); the model always gives 25, padded with zeros."""
        boxes, classes, scores = np.zeros((1, 25, 4), np.float32), np.zeros((1, 25), np.float32), np.zeros((1, 25), np.float32)
        for i, (label, score, box) in enumerate(rows):
            boxes[0, i], classes[0, i], scores[0, i] = box, label, score
        self.tensors = {
            self.BOXES: boxes,
            self.CLASSES: classes,
            self.SCORES: scores,
            self.COUNT: np.array([len(rows) if count is None else count], np.float32),
        }

    def allocate_tensors(self):
        pass

    def get_input_details(self):
        return [self.input]

    def get_output_details(self):
        return self.outputs

    def set_tensor(self, index, value):
        assert index == 0
        self.given = value.copy()

    def invoke(self):
        self.invoked += 1

    def get_tensor(self, index):
        return self.tensors[index]


def frame(color=(90, 90, 90)):
    return np.full((HEIGHT, WIDTH, 3), color, np.uint8)


def test_boxes_come_back_in_pixels_of_the_captured_frame():
    model = FakeInterpreter()
    # Normalised to the model's 320x320 input, which is the whole frame stretched: × 640 and × 480.
    model.answer([(PERSON, 0.8, [0.25, 0.1, 0.75, 0.4])])
    (d,) = TFLiteDetector(model).detect(frame())
    # float32 out of the model: 0.1 × 640 is 64.000001.
    assert (d.x, d.y, d.w, d.h, d.confidence) == pytest.approx((64, 120, 192, 240, 0.8))
    # Another frame size, another scale: nothing assumes 640x480.
    (d,) = TFLiteDetector(model).detect(np.zeros((240, 320, 3), np.uint8))
    assert (d.x, d.y, d.w, d.h) == pytest.approx((32, 60, 96, 120))


def test_the_frame_is_given_stretched_to_the_input_in_rgb():
    model = FakeInterpreter(size=(320, 320))
    image = frame((255, 0, 0))  # BGR blue
    image[:, WIDTH // 2 :] = (0, 0, 255)  # the right half red
    TFLiteDetector(model).detect(image)
    given = model.given
    assert given.shape == (1, 320, 320, 3) and given.dtype == np.uint8
    # Stretched, not letterboxed: blue on the left half of the input, red on the right, no band.
    assert tuple(given[0, 160, 10]) == (0, 0, 255) and tuple(given[0, 160, 310]) == (255, 0, 0)
    assert tuple(given[0, 2, 10]) == (0, 0, 255) and tuple(given[0, 317, 310]) == (255, 0, 0)


def test_a_float_model_gets_pixels_scaled_to_minus_one_one():
    model = FakeInterpreter(dtype=np.float32)
    TFLiteDetector(model).detect(frame((255, 255, 255)))
    assert model.given.dtype == np.float32 and model.given.max() == pytest.approx(1.0)


def test_only_people_at_min_score_and_above_are_kept_most_confident_first():
    model = FakeInterpreter()
    model.answer([
        (CAR, 0.95, [0.1, 0.1, 0.3, 0.3]),
        (PERSON, 0.5, [0.2, 0.2, 0.6, 0.3]),
        (DOG, 0.9, [0.5, 0.5, 0.9, 0.9]),
        (PERSON, 0.49, [0.1, 0.6, 0.5, 0.7]),
        (PERSON, 0.7, [0.3, 0.7, 0.9, 0.8]),
    ])
    detections = TFLiteDetector(model, min_score=0.5).detect(frame())
    assert [d.confidence for d in detections] == [0.7, 0.5]
    assert detections[0].x == pytest.approx(0.7 * WIDTH)
    assert [d.confidence for d in TFLiteDetector(model, min_score=0.6).detect(frame())] == [0.7]


def test_rows_past_the_count_are_ignored():
    model = FakeInterpreter()
    model.answer([(PERSON, 0.9, [0.1, 0.1, 0.5, 0.3]), (PERSON, 0.8, [0.1, 0.5, 0.5, 0.7])], count=1)
    assert [d.confidence for d in TFLiteDetector(model).detect(frame())] == [0.9]


def test_boxes_past_the_frame_are_clipped_and_empty_ones_dropped():
    model = FakeInterpreter()
    model.answer([(PERSON, 0.9, [-0.1, -0.05, 1.2, 0.5]), (PERSON, 0.8, [0.5, 0.5, 0.5, 0.7])])
    (d,) = TFLiteDetector(model).detect(frame())
    assert (d.x, d.y, d.w, d.h) == pytest.approx((0, 0, 320, 480))


def test_nobody_gives_nothing():
    model = FakeInterpreter()
    assert TFLiteDetector(model).detect(frame()) == []
    assert model.invoked == 1


def test_a_model_without_its_post_processing_is_refused():
    # MediaPipe's EfficientDet-Lite0: raw anchors out, decoding left to MediaPipe.
    raw = [{"index": 1, "shape": np.array([1, 19206, 90])}, {"index": 2, "shape": np.array([1, 19206, 4])}]
    with pytest.raises(ConfigError, match="TFLITE_MODEL: expected a detection model with its post-processing"):
        TFLiteDetector(FakeInterpreter(outputs=raw))
    with pytest.raises(ConfigError, match="TFLITE_MODEL: expected a 1xHxWx3"):
        TFLiteDetector(FakeInterpreter(dtype=np.int16))


def test_a_missing_model_says_which_variable_and_how_to_fetch_it(tmp_path):
    with pytest.raises(ConfigError, match=r"TFLITE_MODEL: no model at .*fetch_model\.py"):
        load_interpreter(str(tmp_path / "nothing.tflite"), 4)


def test_a_missing_runtime_says_what_to_install(tmp_path, monkeypatch):
    model = tmp_path / "model.tflite"
    model.write_bytes(b"not read")
    # None in sys.modules: the import fails as if the package were not installed.
    monkeypatch.setitem(sys.modules, "ai_edge_litert", None)
    monkeypatch.setitem(sys.modules, "ai_edge_litert.interpreter", None)
    monkeypatch.setitem(sys.modules, "tflite_runtime", None)
    monkeypatch.setitem(sys.modules, "tflite_runtime.interpreter", None)
    with pytest.raises(ConfigError, match="DETECTOR=tflite needs the TensorFlow Lite runtime.*ai-edge-litert"):
        load_interpreter(str(model), 4)


@pytest.fixture
def env(monkeypatch):
    for name in ("TFLITE_MODEL", "TFLITE_THREADS", "MIN_CONFIDENCE", "MOTION_GATE", "MOTION_GATE_HOLD_S"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_the_registry_makes_it_from_its_settings(env):
    model, opened = FakeInterpreter(), []

    def load(path, threads):
        opened.append((path, threads))
        return model

    env.setattr(tflite, "load_interpreter", load)
    assert "tflite" in DETECTORS
    detector = make_detector("tflite")
    assert detector.name == "tflite" and opened == [("/models/efficientdet_lite0.tflite", 4)]
    env.setenv("TFLITE_MODEL", "/elsewhere/model.tflite")
    env.setenv("TFLITE_THREADS", "2")
    # The service's MIN_CONFIDENCE, so that the detector and the service agree on who is nobody.
    env.setenv("MIN_CONFIDENCE", "0.8")
    detector = make_detector("tflite")
    assert opened[-1] == ("/elsewhere/model.tflite", 2) and detector.threads == 2
    model.answer([(PERSON, 0.75, [0.1, 0.1, 0.5, 0.3]), (PERSON, 0.85, [0.1, 0.5, 0.5, 0.7])])
    assert [d.confidence for d in detector.detect(frame())] == [0.85]
    env.setenv("MOTION_GATE", "true")
    assert make_detector("tflite").name == "tflite+motion"


def test_without_a_model_the_service_stops_with_the_variable_named(env, tmp_path):
    env.setenv("TFLITE_MODEL", str(tmp_path / "absent.tflite"))
    with pytest.raises(ConfigError, match="TFLITE_MODEL"):
        make_detector("tflite")
    env.setenv("TFLITE_THREADS", "0")
    with pytest.raises(ConfigError, match="TFLITE_THREADS"):
        make_detector("tflite")


# --- with the real model ------------------------------------------------------------------------------
# Fetched once, out of git: `python3 vision/fetch_model.py ~/.cache/sentinel-x/efficientdet_lite0.tflite`
# from ai/ (or TFLITE_MODEL pointing at it). Skipped without it, or without the runtime.

CACHE = os.path.expanduser("~/.cache/sentinel-x")
MODEL = os.environ.get("TFLITE_MODEL") or os.path.join(CACHE, "efficientdet_lite0.tflite")
# A person to find: NASA's portrait of the astronaut Eileen Collins (public domain), as scikit-image ships
# it for its examples (skimage.data.astronaut()), 512x512. Fetched once into the cache, sha256 checked.
ASTRONAUT_URL = "https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/astronaut.png"
ASTRONAUT_SHA256 = "88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5"


@pytest.fixture(scope="module")
def detector():
    if not os.path.isfile(MODEL):
        pytest.skip(f"no model at {MODEL}: python3 vision/fetch_model.py {MODEL}")
    try:
        import ai_edge_litert  # noqa: F401
    except ImportError:
        pytest.skip("no TFLite runtime: pip install -r vision/requirements.txt")
    return TFLiteDetector(load_interpreter(MODEL, 4), min_score=0.5)


@pytest.fixture(scope="module")
def astronaut():
    path = os.path.join(CACHE, "astronaut.png")
    try:
        fetch_model.fetch(path, ASTRONAUT_URL, ASTRONAUT_SHA256, timeout=10)
    except fetch_model.FetchError as error:
        pytest.skip(f"no reference image: {error}")
    return cv2.imread(path)


def test_the_model_finds_the_person_in_the_reference_image(detector, astronaut):
    # As the camera would give it: 640x480, the portrait stretched.
    image = cv2.resize(astronaut, (WIDTH, HEIGHT))
    detections = detector.detect(image)
    assert detections, "nobody found"
    d = detections[0]
    assert d.confidence >= 0.7
    # She stands on the left two thirds, head near the top, down to the bottom of the picture.
    assert 0.25 < (d.x + d.w / 2) / WIDTH < 0.45
    assert d.y < 0.1 * HEIGHT and d.y + d.h > 0.9 * HEIGHT
    assert 0.4 * WIDTH < d.w < 0.85 * WIDTH


def test_the_model_finds_nobody_in_an_empty_image(detector):
    noise = np.random.default_rng(0).integers(0, 256, (HEIGHT, WIDTH, 3), dtype=np.uint8)
    for image in (frame((0, 0, 0)), frame((128, 128, 128)), frame((255, 255, 255)), noise):
        assert detector.detect(image) == []


def test_the_model_counts_person_as_its_class_0(detector):
    # The label map ships inside the .tflite (a zip appended to it): person must be its first line.
    with zipfile.ZipFile(MODEL) as archive:
        (name,) = [n for n in archive.namelist() if n.endswith(".txt")]
        labels = archive.read(name).decode().splitlines()
    assert labels[0] == "person"
