from datetime import datetime, timedelta, timezone

from sentinel_common.contract import alert_errors

from predictive import simulate
from predictive.detector import DriftDetector, Monitor, alert_of, replay
from predictive.features import Sample, sample_of
from predictive.model import Verdict

RAISE, CLEAR = 0.60, 0.55
T0 = datetime(2026, 10, 6, 8, 0, tzinfo=timezone.utc)


def run(scores, detector=None):
    """Feeds one score a second; returns (second, transition) of each transition."""
    detector = detector or DriftDetector(RAISE, CLEAR)
    out = []
    for i, score in enumerate(scores):
        ts = (T0 + timedelta(seconds=i)).strftime("%Y-%m-%dT%H:%M:%SZ")
        transition = detector.observe(Verdict(score, ["temp_slope"]), Sample(T0.timestamp() + i, 25, 45, 200, ts))
        if transition:
            out.append((i, transition))
    return out


def test_five_scores_in_a_row_at_the_raise_level_raise_it():
    [(second, transition)] = run([0.5] * 3 + [RAISE] * 5 + [0.65] * 20)
    assert (second, transition.state) == (7, "raised")
    # The Alert carries the ts of the snapshot that tipped it.
    assert transition.sample.ts == "2026-10-06T08:00:07Z"


def test_a_lone_odd_window_does_not_raise():
    assert run(([0.5] * 10 + [0.9]) * 20) == []
    assert run(([0.5] * 10 + [0.9] * 4) * 20) == []


def test_a_score_hovering_around_the_raise_level_does_not_raise():
    assert run([0.61, 0.59] * 200) == []


def test_ten_scores_in_a_row_under_the_clear_level_clear_it():
    transitions = run([0.7] * 5 + [0.5] * 9 + [0.58] + [0.5] * 10 + [0.7] * 3)
    assert [(s, t.state) for s, t in transitions] == [(4, "raised"), (24, "cleared")]


def test_a_score_hovering_between_the_levels_does_not_flap():
    # Back under the raise level but not under the clear level: still a drift.
    transitions = run([0.7] * 5 + [0.57, 0.62, 0.5, 0.56] * 200)
    assert [t.state for _, t in transitions] == ["raised"]


def test_each_episode_has_its_own_alert_id():
    transitions = run(([0.7] * 5 + [0.5] * 10) * 3)
    assert [t.state for _, t in transitions] == ["raised", "cleared"] * 3
    ids = [t.alert_id for _, t in transitions]
    # A cleared pairs with its raised; a new episode is a new Alert.
    assert ids[0::2] == ids[1::2]
    assert len(set(ids)) == 3


def test_the_counts_are_configurable():
    detector = DriftDetector(RAISE, CLEAR, raise_after=2, clear_after=3)
    assert [(s, t.state) for s, t in run([0.7] * 2 + [0.5] * 3, detector)] == [(1, "raised"), (4, "cleared")]


def test_an_alert_follows_the_contract():
    (_, raised), (_, cleared) = run([0.912345] * 5 + [0.5] * 10)
    alert = alert_of(raised, "sentinel-01")
    assert alert_errors(alert) == []
    assert alert_errors(alert_of(cleared, "sentinel-01")) == []
    assert alert == {
        "alert_id": raised.alert_id,
        "sentinel": "sentinel-01",
        "kind": "predictive",
        "severity": "warning",
        "state": "raised",
        "detail": {"anomaly_score": 0.912, "drivers": ["temp_slope"]},
        "ts": "2026-10-06T08:00:04Z",
    }
    # `source` is the api's to set, from the token.
    assert "source" not in alert


def test_the_live_monitor_emits_what_a_replay_emits(model):
    # The beginning of the reference drift, snapshot by snapshot as the live service gets them:
    # up to just after the raise (a single scoring costs ~10 ms, the whole run would be slow).
    outcome = simulate.run(model)
    samples = [sample_of(p) for p in outcome.scenario.payloads]
    samples = [s for s in samples if outcome.scenario.drift_from - 150 <= s.t <= outcome.raised_at + 5]
    monitor = Monitor(model, "sentinel-01")
    live = [a for a in map(monitor.push, samples) if a]
    replayed = replay(model, samples, "sentinel-01")
    strip = lambda alerts: [{k: v for k, v in a.items() if k != "alert_id"} for a in alerts]
    assert strip(live) == strip(replayed)
    assert [a["state"] for a in live] == ["raised"]
