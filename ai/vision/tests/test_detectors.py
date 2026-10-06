import cv2
import numpy as np
import pytest

from sentinel_common.config import ConfigError
from vision.detectors import DETECTORS, MotionDetector, MotionGate, make_detector
from vision.tracker import Detection

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
    with pytest.raises(ConfigError, match="DETECTOR: expected one of tflite, motion, got 'yolo'"):
        make_detector("yolo")


# --- the motion gate ----------------------------------------------------------------------------------


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class Scripted:
    """A detector that sees what the test says (`sees`), and counts its calls."""

    def __init__(self, name="person"):
        self.name = name
        self.sees = []
        self.calls = 0

    def detect(self, image):
        self.calls += 1
        return list(self.sees)


BLANK = np.zeros((HEIGHT, WIDTH, 3), np.uint8)
SOMEONE = [Detection(100, 100, 50, 120, 0.9)]


def gated(hold=3.0):
    clock, person, motion = Clock(), Scripted(), Scripted("motion")
    return MotionGate(person, motion, hold=hold, clock=clock), clock, person, motion


def run_for(gate, clock, seconds, step=0.25):
    """A frame every `step` s (exact in binary: no drift) for `seconds`: what the gate returned on each."""
    results = []
    for _ in range(round(seconds / step)):
        results.append(gate.detect(BLANK))
        clock.now += step
    return results


def test_the_gate_runs_the_model_at_first_then_rests_while_nothing_moves():
    gate, clock, person, motion = gated()
    # Open for the first 3 s: the motion detector is still learning, someone may already be there.
    run_for(gate, clock, 3.0)
    assert person.calls == 12
    run_for(gate, clock, 10.0)
    assert person.calls == 12 and gate.runs == 12
    # The motion detector sees every frame, gate open or closed: its background keeps learning.
    assert motion.calls == 52


def test_the_gate_stays_open_while_the_motion_detector_learns_the_scene():
    clock, person, motion = Clock(), Scripted(), Scripted("motion")
    # A slow machine: 1 frame a second, so 20 warm-up frames outlast the 3 s.
    gate = MotionGate(person, motion, hold=3.0, warmup=20, clock=clock)
    run_for(gate, clock, 30.0, step=1.0)
    # The 20 frames, and the 2 that come within 3 s of the 20th.
    assert person.calls == 22


def test_movement_opens_the_gate_for_hold_seconds():
    gate, clock, person, motion = gated()
    run_for(gate, clock, 5.0)
    calls = person.calls
    motion.sees = SOMEONE
    run_for(gate, clock, 0.25)
    motion.sees = []
    assert person.calls == calls + 1
    # 3 s after the movement, and not one frame more.
    run_for(gate, clock, 2.75)
    assert person.calls == calls + 12
    run_for(gate, clock, 5.0)
    assert person.calls == calls + 12


def test_someone_standing_still_keeps_the_model_running_and_is_seen_all_along():
    gate, clock, person, motion = gated()
    motion.sees = SOMEONE
    person.sees = SOMEONE
    run_for(gate, clock, 1.0)
    # They stop moving: motion loses them, the model does not.
    motion.sees = []
    assert run_for(gate, clock, 60.0) == [SOMEONE] * 240
    # They are gone (without a movement motion could see): the model runs 3 s more, then rests.
    person.sees = []
    calls = person.calls
    assert run_for(gate, clock, 10.0) == [[]] * 40
    assert person.calls - calls == 11


def test_a_person_detector_is_gated_by_motion_when_motion_gate_says_so(monkeypatch):
    monkeypatch.setitem(DETECTORS, "fake", Scripted)
    monkeypatch.setenv("MOTION_GATE", "true")
    monkeypatch.setenv("MOTION_GATE_HOLD_S", "5")
    detector = make_detector("fake")
    assert isinstance(detector, MotionGate) and detector.name == "person+motion"
    # Open for the motion detector's 20 warm-up frames, whatever the time they take.
    for _ in range(20):
        detector.detect(BLANK)
    assert detector.runs == 20
    assert detector.inner.name == "person"
    monkeypatch.setenv("MOTION_GATE", "false")
    assert isinstance(make_detector("fake"), Scripted)


@pytest.mark.parametrize(
    ("detector", "variable", "value", "message"),
    [
        ("motion", "MOTION_GATE", "true", "MOTION_GATE: .* not DETECTOR=motion"),
        ("fake", "MOTION_GATE", "maybe", "MOTION_GATE: expected true or false"),
        ("fake", "MOTION_GATE_HOLD_S", "0", "MOTION_GATE_HOLD_S"),
    ],
)
def test_a_bad_motion_gate_setting_is_named(monkeypatch, detector, variable, value, message):
    monkeypatch.setitem(DETECTORS, "fake", Scripted)
    monkeypatch.setenv("MOTION_GATE", "true")
    monkeypatch.setenv(variable, value)
    with pytest.raises(ConfigError, match=message):
        make_detector(detector)


class Painted:
    """A stand-in for the person detector that really looks: the Scene's "person" is its only colour."""

    name = "painted"

    def detect(self, image):
        mask = cv2.inRange(image, (195, 175, 155), (205, 185, 165))
        x, y, w, h = cv2.boundingRect(mask)
        return [Detection(x, y, w, h, 0.9)] if w * h > 1000 else []


def test_with_the_real_motion_detector_someone_who_walks_in_and_stops_stays_seen():
    scene, clock = Scene(seed=4), Clock()
    gate = MotionGate(Painted(), MotionDetector(), hold=3.0, clock=clock)

    def frame(x=None):
        clock.now += 0.1
        return gate.detect(scene.frame(x))

    # An empty scene: once the first 3 s are over, the model rests.
    assert all(frame() == [] for _ in range(60))
    runs = gate.runs
    for _ in range(30):
        frame()
    assert gate.runs == runs
    # Someone walks in: motion opens the gate, the model sees them.
    seen = [frame(x) for x in range(40, 300, 10)]
    assert all(seen[3:])
    # They stand still for a minute: long since faded into motion's background, still seen on every frame.
    assert all(len(frame(300)) == 1 for _ in range(600))
    # They leave: nothing seen. The model rests again once motion stops seeing the spot they stood on,
    # which it had partly learnt as background: a "ghost" for a few seconds (about 5 here).
    assert all(frame() == [] for _ in range(150))
    runs = gate.runs
    for _ in range(30):
        frame()
    assert gate.runs == runs
