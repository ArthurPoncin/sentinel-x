import re

import pytest

from sentinel_common.contract import alert_errors
from vision.tracker import Detection, IntruderTracker

WIDTH, HEIGHT = 640, 480


def person(x_norm: float, confidence: float = 0.9) -> Detection:
    """A 60x180 person whose box is centred on x_norm."""
    return Detection(x=x_norm * WIDTH - 30, y=80, w=60, h=180, confidence=confidence)


def step(tracker: IntruderTracker, now: float, *people: Detection) -> list[dict]:
    """One inference; every Alert it gives must be one the api accepts."""
    alerts = tracker.update(list(people), now)
    for alert in alerts:
        assert alert_errors(alert) == [], alert
    return alerts


def tick(tracker: IntruderTracker, now: float) -> list[dict]:
    alerts = tracker.tick(now)
    for alert in alerts:
        assert alert_errors(alert) == [], alert
    return alerts


def arrived(x_norm: float = 0.3) -> tuple[IntruderTracker, dict]:
    """A tracker that has just raised an intrusion at x_norm, at t = 0.2 s."""
    tracker = IntruderTracker(WIDTH, HEIGHT)
    assert step(tracker, 0.0, person(x_norm)) == []
    [raised] = step(tracker, 0.2, person(x_norm))
    return tracker, raised


def test_raises_once_a_person_is_seen_on_two_inferences_in_a_row():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    assert step(tracker, 0.0, person(0.42)) == []
    assert not tracker.active
    [raised] = step(tracker, 0.2, person(0.42))
    assert raised["kind"] == "intrusion"
    assert raised["severity"] == "critical"
    assert raised["state"] == "raised"
    assert raised["sentinel"] == "sentinel-01"
    assert raised["detail"]["x_norm"] == 0.42
    assert re.fullmatch(r"vision-[0-9a-f]{12}", raised["alert_id"])
    assert "source" not in raised and "value" not in raised
    assert tracker.active and tracker.alert_id == raised["alert_id"]
    # Still there, still at the same place: it was said once.
    assert step(tracker, 0.4, person(0.42)) == []


def test_a_one_frame_flash_raises_nothing():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    assert step(tracker, 0.0, person(0.5)) == []
    assert step(tracker, 0.2) == []
    assert step(tracker, 0.4, person(0.5)) == []
    for i in range(3, 30):
        assert step(tracker, i * 0.2) == []
    assert not tracker.active


def test_a_move_is_raised_again_on_the_same_alert_id():
    tracker, raised = arrived(0.3)
    [moved] = step(tracker, 0.8, person(0.4))
    assert moved["state"] == "raised"
    assert moved["alert_id"] == raised["alert_id"]
    assert moved["detail"]["x_norm"] == 0.4


def test_someone_walking_across_sends_at_most_two_alerts_a_second():
    tracker, raised = arrived(0.0)
    sent = [(0.2, raised)]
    # Left to right in 3 s, an inference every 100 ms: far more movement than 0.05 between frames.
    for i in range(3, 33):
        now = i * 0.1
        sent += [(now, alert) for alert in step(tracker, now, person((i - 2) / 30))]
    times = [now for now, _ in sent]
    assert all(later - earlier >= 0.5 - 1e-9 for earlier, later in zip(times, times[1:]))
    assert len(sent) >= 5
    assert {alert["alert_id"] for _, alert in sent} == {raised["alert_id"]}
    assert sent[-1][1]["detail"]["x_norm"] > 0.8


def test_a_move_held_back_by_the_interval_is_sent_once_it_is_over():
    tracker, raised = arrived(0.3)
    assert step(tracker, 0.3, person(0.5)) == []  # 100 ms after the last Alert: too soon
    assert step(tracker, 0.5, person(0.5)) == []  # they stopped there, still too soon
    [moved] = step(tracker, 0.7, person(0.5))
    assert moved["detail"]["x_norm"] == 0.5
    assert step(tracker, 0.9, person(0.5)) == []


def test_a_held_back_move_is_sent_by_tick_when_no_inference_comes():
    tracker, _ = arrived(0.3)
    assert step(tracker, 0.3, person(0.5)) == []
    assert tick(tracker, 0.6) == []
    [moved] = tick(tracker, 0.7)
    assert moved["state"] == "raised" and moved["detail"]["x_norm"] == 0.5


def test_a_held_back_move_undone_before_the_interval_is_over_sends_nothing():
    tracker, _ = arrived(0.3)
    assert step(tracker, 0.3, person(0.5)) == []
    assert step(tracker, 0.5, person(0.31)) == []
    assert step(tracker, 0.8, person(0.31)) == []


def test_someone_standing_still_sends_nothing():
    tracker, _ = arrived(0.6)
    for i in range(2, 60):
        assert step(tracker, i * 0.2, person(0.6, confidence=0.7 + (i % 3) / 10)) == []


def test_jitter_under_the_threshold_sends_nothing_but_a_slow_walk_adds_up():
    tracker, _ = arrived(0.5)
    for i in range(2, 30):
        assert step(tracker, i * 0.2, person(0.5 + (0.02 if i % 2 else -0.02))) == []
    # 0.01 a frame: no frame moves 0.05, but five of them do since the last Alert.
    tracker, _ = arrived(0.5)
    sent = [alert for i in range(1, 10) for alert in step(tracker, 0.2 + i * 0.2, person(0.5 + i / 100))]
    assert [alert["detail"]["x_norm"] for alert in sent] == [0.55]


def test_a_brief_miss_neither_clears_nor_starts_a_new_intrusion():
    tracker, raised = arrived(0.3)
    for i in range(2, 14):  # nobody for 2.4 s
        assert step(tracker, i * 0.2) == []
    assert step(tracker, 3.0, person(0.3)) == []
    assert step(tracker, 3.2, person(0.3)) == []
    assert tracker.alert_id == raised["alert_id"]
    # Seen again: the 3 s start over from there.
    assert step(tracker, 6.0) == []


def test_clears_three_seconds_after_the_person_was_last_seen_with_the_last_known_detail():
    tracker, raised = arrived(0.3)
    step(tracker, 0.4, person(0.32))  # a move too small to send, still the last known place
    last_known = {**raised["detail"], "x_norm": 0.32, "bbox": [175, 80, 60, 180]}
    for i in range(3, 17):  # nobody from 0.6 s to 3.2 s
        assert step(tracker, i * 0.2) == []
    [cleared] = step(tracker, 3.4)
    assert cleared["state"] == "cleared"
    assert cleared["alert_id"] == raised["alert_id"]
    assert cleared["severity"] == "critical"
    assert cleared["detail"] == last_known
    assert not tracker.active and tracker.alert_id is None
    assert step(tracker, 3.6) == []


def test_tick_clears_when_inference_stalls():
    tracker, raised = arrived(0.3)
    assert tick(tracker, 3.1) == []
    [cleared] = tick(tracker, 3.2)
    assert cleared["state"] == "cleared" and cleared["alert_id"] == raised["alert_id"]
    assert tick(tracker, 10.0) == []


def test_someone_seen_again_after_a_stall_is_confirmed_afresh():
    tracker, raised = arrived(0.3)
    [cleared] = step(tracker, 10.0, person(0.7))
    assert cleared["state"] == "cleared" and cleared["detail"]["x_norm"] == 0.3
    [again] = step(tracker, 10.2, person(0.7))
    assert again["state"] == "raised" and again["alert_id"] != raised["alert_id"]


def test_whoever_comes_after_a_clear_gets_a_new_alert_id():
    tracker, raised = arrived(0.3)
    [cleared] = step(tracker, 3.2)
    assert step(tracker, 5.0, person(0.8)) == []
    [returned] = step(tracker, 5.2, person(0.8))
    assert returned["state"] == "raised"
    assert returned["alert_id"] != raised["alert_id"]
    assert returned["detail"]["x_norm"] == 0.8


def test_follows_the_most_confident_person():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.2, 0.6), person(0.7, 0.9), person(0.5, 0.4))
    [raised] = step(tracker, 0.2, person(0.2, 0.6), person(0.7, 0.9))
    assert raised["detail"]["x_norm"] == 0.7
    assert raised["detail"]["confidence"] == 0.9
    # The other one becomes the most confident: the intruder is now over there.
    [moved] = step(tracker, 0.8, person(0.2, 0.95), person(0.7, 0.5))
    assert moved["detail"]["x_norm"] == 0.2


def test_x_norm_confidence_and_bbox():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    box = Detection(x=290.0, y=80.6, w=60.0, h=179.7, confidence=0.87654)
    step(tracker, 0.0, box)
    [raised] = step(tracker, 0.2, box)
    assert raised["detail"] == {"x_norm": 0.5, "confidence": 0.877, "bbox": [290, 81, 60, 179]}
    assert all(isinstance(n, int) for n in raised["detail"]["bbox"])


@pytest.mark.parametrize(
    "box, x_norm, bbox",
    [
        (Detection(x=-40, y=10, w=60, h=100, confidence=0.8), 0.0, [0, 10, 20, 100]),
        (Detection(x=620, y=400, w=60, h=100, confidence=0.8), 1.0, [620, 400, 20, 80]),
        (Detection(x=0, y=0, w=640, h=480, confidence=0.8), 0.5, [0, 0, 640, 480]),
    ],
)
def test_a_box_past_the_edge_is_clamped_to_the_image(box, x_norm, bbox):
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, box)
    [raised] = step(tracker, 0.2, box)
    assert raised["detail"]["x_norm"] == x_norm
    assert raised["detail"]["bbox"] == bbox


def test_a_detection_with_a_nan_counts_as_nobody():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.5))
    assert step(tracker, 0.2, Detection(x=float("nan"), y=0, w=10, h=10, confidence=0.9)) == []
    assert not tracker.active


def test_timestamp_sentinel_and_settings_are_the_callers():
    tracker = IntruderTracker(WIDTH, HEIGHT, sentinel="sentinel-02", confirm=1, clear_after=1.0)
    [raised] = tracker.update([person(0.5)], 0.0, ts="2026-10-06T09:00:00.000Z")
    assert raised["ts"] == "2026-10-06T09:00:00.000Z"
    assert raised["sentinel"] == "sentinel-02"
    [cleared] = step(tracker, 1.0)  # ts left out: now, in the api's format
    assert cleared["state"] == "cleared"


def test_the_alerts_returned_are_the_callers_to_change():
    tracker, raised = arrived(0.3)
    raised["detail"]["bbox"][0] = -1
    raised["detail"]["x_norm"] = 0.9
    [cleared] = step(tracker, 3.2)
    assert cleared["detail"]["x_norm"] == 0.3 and cleared["detail"]["bbox"][0] >= 0


@pytest.mark.parametrize(
    "args, settings",
    [
        ((0, 480), {}),
        ((640, -1), {}),
        ((640.0, 480), {}),
        ((True, 480), {}),
        ((640, 480), {"sentinel": ""}),
        ((640, 480), {"sentinel": None}),
        ((640, 480), {"confirm": 0}),
        ((640, 480), {"confirm": 1.5}),
        ((640, 480), {"move_threshold": 0}),
        ((640, 480), {"move_threshold": 1.5}),
        ((640, 480), {"move_threshold": float("nan")}),
        ((640, 480), {"min_interval": -0.1}),
        ((640, 480), {"clear_after": 0}),
        ((640, 480), {"clear_after": float("inf")}),
    ],
)
def test_refuses_invalid_settings(args, settings):
    with pytest.raises(ValueError):
        IntruderTracker(*args, **settings)
