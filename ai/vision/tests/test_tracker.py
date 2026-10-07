import math
import re

import pytest

from sentinel_common.contract import alert_errors
from vision.tracker import Detection, IntruderTracker

WIDTH, HEIGHT = 640, 480


def person(x_norm: float, confidence: float = 0.9, height: float = 180) -> Detection:
    """A person 60 wide and 180 tall, unless told, whose box is centred on x_norm."""
    return Detection(x=x_norm * WIDTH - 30, y=80, w=60, h=height, confidence=confidence)


def across(bearing: float, pan: float, fov: float = 60) -> float:
    """Where someone standing `bearing` degrees round from where the camera rests is across the image of a
    camera turned by `pan`: a flat image, so by the tangent of the angle off its axis."""
    return 0.5 + math.tan(math.radians(bearing - pan)) / (2 * math.tan(math.radians(fov / 2)))


def step(tracker: IntruderTracker, now: float, *people: Detection, pan: float = 0.0) -> list[dict]:
    """One inference; every Alert it gives must be one the api accepts."""
    alerts = tracker.update(list(people), now, pan=pan)
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


def test_follows_the_nearest_person_and_keeps_to_them():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    far, near = person(0.2, height=120), person(0.7, height=300)
    step(tracker, 0.0, far, near)
    [raised] = step(tracker, 0.2, far, near)
    assert raised["detail"]["x_norm"] == 0.7
    assert raised["detail"]["h_norm"] == 0.625
    # The other one comes nearer than them: they are still the one followed.
    [moved] = step(tracker, 0.8, person(0.2, height=400), near)
    assert moved["detail"]["id"] == raised["detail"]["id"]
    assert moved["detail"]["x_norm"] == 0.7


def test_of_two_people_as_near_follows_the_one_the_detector_is_surest_of():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.2, 0.6), person(0.7, 0.9), person(0.5, 0.4))
    [raised] = step(tracker, 0.2, person(0.2, 0.6), person(0.7, 0.9))
    assert raised["detail"]["x_norm"] == 0.7
    assert raised["detail"]["confidence"] == 0.9
    # The other becomes the surer one: the person followed does not change for that.
    assert step(tracker, 0.8, person(0.2, 0.95), person(0.7, 0.5)) == []


def test_x_norm_confidence_and_bbox():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    box = Detection(x=290.0, y=80.6, w=60.0, h=179.7, confidence=0.87654)
    step(tracker, 0.0, box)
    [raised] = step(tracker, 0.2, box)
    assert raised["detail"] == {
        "x_norm": 0.5,
        "confidence": 0.877,
        "bbox": [290, 81, 60, 179],
        "id": 1,
        "h_norm": 0.374,
        "pan": 0.0,
        "others": [],
    }
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


def test_h_norm_is_the_share_of_the_image_the_box_takes_in_height():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.5, height=240))
    [raised] = step(tracker, 0.2, person(0.5, height=240))
    assert raised["detail"]["h_norm"] == 0.5
    # A box that goes past the bottom of the image is as tall as what the image holds of it.
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.5, height=1000))
    [raised] = step(tracker, 0.2, person(0.5, height=1000))
    assert raised["detail"]["h_norm"] == round(400 / 480, 3)


def test_someone_coming_nearer_is_raised_again_on_the_same_alert_id():
    tracker, raised = arrived(0.3)
    # 180 to 200 pixels tall: 0.04 of the image, under the threshold.
    assert step(tracker, 0.8, person(0.3, height=200)) == []
    [nearer] = step(tracker, 1.0, person(0.3, height=230))
    assert nearer["state"] == "raised" and nearer["alert_id"] == raised["alert_id"]
    assert nearer["detail"]["h_norm"] == round(230 / 480, 3)
    assert nearer["detail"]["x_norm"] == 0.3


def test_the_others_are_told_beside_the_person_followed_the_nearest_first():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    crowd = [person(0.5, height=300), person(0.15, 0.7, height=120), person(0.85, 0.8, height=200)]
    step(tracker, 0.0, *crowd)
    [raised] = step(tracker, 0.2, *crowd)
    detail = raised["detail"]
    assert (detail["id"], detail["x_norm"]) == (1, 0.5)
    assert detail["others"] == [
        {"id": 3, "x_norm": 0.85, "h_norm": round(200 / 480, 3), "confidence": 0.8},
        {"id": 2, "x_norm": 0.15, "h_norm": 0.25, "confidence": 0.7},
    ]
    # Everyone still where they were: it was said once.
    assert step(tracker, 0.8, *crowd) == []


def test_tells_at_most_five_people_the_one_followed_and_the_four_nearest_others():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    crowd = [person(0.05 + i * 0.13, height=100 + i * 30) for i in range(7)]
    step(tracker, 0.0, *crowd)
    [raised] = step(tracker, 0.2, *crowd)
    assert raised["detail"]["h_norm"] == round(280 / 480, 3)
    assert [other["h_norm"] for other in raised["detail"]["others"]] == [round(h / 480, 3) for h in (250, 220, 190, 160)]


def test_each_person_keeps_their_id_while_they_walk():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.3, height=300), person(0.8))
    [raised] = step(tracker, 0.2, person(0.3, height=300), person(0.8))
    ids = (raised["detail"]["id"], raised["detail"]["others"][0]["id"])
    # They walk toward each other, an inference every 100 ms, and are handed to the tracker in any order.
    sent = []
    for i in range(1, 11):
        sent += step(tracker, 0.2 + i * 0.1, person(0.8 - i * 0.015), person(0.3 + i * 0.015, height=300))
    last = sent[-1]["detail"]
    assert (last["id"], last["others"][0]["id"]) == ids
    assert last["x_norm"] == pytest.approx(0.45) and last["others"][0]["x_norm"] == pytest.approx(0.65)


def test_someone_who_comes_is_told_once_seen_twice_and_someone_who_leaves_a_second_after_they_were_last_seen():
    tracker, raised = arrived(0.3)
    # A flash beside them: nobody.
    assert step(tracker, 0.8, person(0.3), person(0.8, height=120)) == []
    assert step(tracker, 1.0, person(0.3)) == []
    # Someone, seen twice.
    assert step(tracker, 1.2, person(0.3), person(0.8, height=120)) == []
    [joined] = step(tracker, 1.4, person(0.3), person(0.8, height=120))
    assert joined["alert_id"] == raised["alert_id"]
    assert [other["x_norm"] for other in joined["detail"]["others"]] == [0.8]
    # Missed for a few inferences: still there.
    for i in range(1, 5):
        assert step(tracker, 1.4 + i * 0.2, person(0.3)) == []
    # Not seen for a second: gone.
    [left] = step(tracker, 2.4, person(0.3))
    assert left["detail"]["others"] == [] and left["detail"]["id"] == raised["detail"]["id"]


def test_someone_alone_who_goes_far_between_two_inferences_is_still_the_same_person():
    tracker, raised = arrived(0.2)
    # Further than a quarter of the field in one go: a slow model, a fast walker.
    [moved] = step(tracker, 0.8, person(0.7))
    assert (moved["alert_id"], moved["detail"]["id"]) == (raised["alert_id"], raised["detail"]["id"])
    assert (moved["detail"]["x_norm"], moved["detail"]["others"]) == (0.7, [])


def test_when_the_person_followed_leaves_the_nearest_of_the_others_is():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    step(tracker, 0.0, person(0.3, height=300), person(0.8))
    [raised] = step(tracker, 0.2, person(0.3, height=300), person(0.8))
    other = raised["detail"]["others"][0]["id"]
    for i in range(1, 5):
        assert step(tracker, 0.2 + i * 0.2, person(0.8)) == []
    [handed] = step(tracker, 1.2, person(0.8))
    assert handed["alert_id"] == raised["alert_id"]
    assert (handed["detail"]["id"], handed["detail"]["x_norm"], handed["detail"]["others"]) == (other, 0.8, [])


def test_a_flash_elsewhere_does_not_take_the_place_of_the_person_last_followed():
    tracker, raised = arrived(0.3)
    for i in range(2, 8):  # nobody from 0.4 s to 1.4 s: the hold is over
        assert step(tracker, i * 0.2) == []
    assert step(tracker, 1.6, person(0.8)) == []
    assert step(tracker, 1.8) == []
    [cleared] = step(tracker, 4.6)
    assert cleared["state"] == "cleared" and cleared["detail"]["x_norm"] == 0.3
    assert cleared["detail"]["id"] == raised["detail"]["id"]


def test_the_target_is_where_the_person_followed_stands_around_the_camera():
    tracker = IntruderTracker(WIDTH, HEIGHT, fov=60)
    assert tracker.target is None and tracker.followed_box is None
    step(tracker, 0.0, person(0.5))
    assert tracker.target == pytest.approx(0)
    # The right edge of the image is half the field of view off its axis.
    step(tracker, 0.2, person(1.0))
    assert tracker.target == pytest.approx(30)
    assert tracker.followed_box == [610, 80, 30, 180]
    # Three quarters across is not half that angle: the image is flat.
    tracker = IntruderTracker(WIDTH, HEIGHT, fov=60)
    step(tracker, 0.0, person(0.75))
    assert tracker.target == pytest.approx(16.102, abs=1e-3)
    # Not seen by the last inference: nothing new to turn to.
    step(tracker, 0.2)
    assert tracker.target is None and tracker.followed_box is None


def test_a_camera_that_turns_tells_how_far_and_sees_people_where_they_stand():
    tracker = IntruderTracker(WIDTH, HEIGHT, fov=60)
    step(tracker, 0.0, person(0.75), pan=0.0)
    [raised] = step(tracker, 0.2, person(0.75), pan=0.0)
    assert raised["detail"]["pan"] == 0.0
    # The camera turns to them: they stand still, and are seen nearer the middle of its image.
    bearing = tracker.target
    assert step(tracker, 0.4, person(across(bearing, 2.0)), pan=2.0) == []
    assert tracker.target == pytest.approx(bearing)
    [turned] = step(tracker, 0.8, person(across(bearing, 16.1)), pan=16.1)
    assert turned["alert_id"] == raised["alert_id"]
    assert (turned["detail"]["pan"], turned["detail"]["x_norm"], turned["detail"]["id"]) == (16.1, 0.5, 1)
    # Turned by less than 3 degrees since, and they by less than 0.05 of its image: nothing to say.
    assert step(tracker, 1.4, person(across(bearing, 14.0)), pan=14.0) == []


def test_someone_missed_while_the_camera_turns_is_placed_where_they_now_are_in_its_image():
    tracker = IntruderTracker(WIDTH, HEIGHT, fov=60)
    step(tracker, 0.0, person(0.5, height=300), person(0.75), pan=0.0)
    [raised] = step(tracker, 0.2, person(0.5, height=300), person(0.75), pan=0.0)
    assert raised["detail"]["others"][0]["x_norm"] == 0.75
    # The camera has turned 10 degrees to its left and the detector misses the second one: they have not
    # moved, so they are further to the right of its image.
    # Where three quarters across the image of a camera at rest is, round from its axis.
    there = math.degrees(math.atan(0.5 * math.tan(math.radians(30))))
    [turned] = step(tracker, 0.8, person(across(0.0, -10.0), height=300), pan=-10.0)
    assert turned["detail"]["x_norm"] == pytest.approx(across(0.0, -10.0), abs=1e-3)
    assert turned["detail"]["others"][0]["x_norm"] == pytest.approx(across(there, -10.0), abs=1e-3)
    assert turned["detail"]["others"][0]["x_norm"] > 0.9
    # Turned further, they are out of what it frames: it no longer tells of them.
    [gone] = step(tracker, 1.4, person(across(0.0, -20.0), height=300), pan=-20.0)
    assert gone["detail"]["others"] == []


def test_refuses_a_pan_that_is_not_a_number():
    tracker = IntruderTracker(WIDTH, HEIGHT)
    with pytest.raises(ValueError):
        tracker.update([person(0.5)], 0.0, pan=float("nan"))


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
        ((640, 480), {"fov": 0}),
        ((640, 480), {"fov": 180}),
        ((640, 480), {"max_people": 0}),
        ((640, 480), {"max_people": 6}),
        ((640, 480), {"hold": -1}),
        ((640, 480), {"gate": 0}),
        ((640, 480), {"near_threshold": 0}),
        ((640, 480), {"pan_threshold": 0}),
    ],
)
def test_refuses_invalid_settings(args, settings):
    with pytest.raises(ValueError):
        IntruderTracker(*args, **settings)
