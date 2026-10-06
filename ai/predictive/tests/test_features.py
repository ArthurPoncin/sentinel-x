import math

import numpy as np
import pytest

from predictive.features import FEATURES, Sample, SlidingWindow, sample_of, windows_of

T0 = 1_790_000_000.0  # some second of 2026


def sample(t, temp=25.0, humidity=45.0, air=200.0):
    return Sample(T0 + t, temp, humidity, air, "2026-10-06T08:00:00Z")


def payload(ts="2026-10-06T08:00:00Z", **readings):
    return {"sentinel": "sentinel-01", "ts": ts, "readings": {"temp": 25.0, "humidity": 45.0, "air": 200, "pir": False, "sound": 0.02, **readings}}


def without(reading):
    bad = payload()
    del bad["readings"][reading]
    return bad


def test_the_vector_of_a_known_series():
    # 120 s at 1 Hz: temp climbs 0.5 °C/min, air falls 3 counts/min, humidity holds.
    window, vector = SlidingWindow(), None
    for t in range(120):
        vector = window.push(sample(t, temp=20 + 0.5 * t / 60, air=300 - 3 * t / 60))
    assert dict(zip(FEATURES, vector)) == pytest.approx(
        {
            "temp": 20 + 0.5 * 119 / 60,
            "humidity": 45.0,
            "air": 300 - 3 * 119 / 60,
            "temp_slope": 0.5,
            "air_slope": -3.0,
            "temp_mean": 20 + 0.5 * 59.5 / 60,
            "air_mean": 300 - 3 * 59.5 / 60,
        }
    )


def test_the_slope_sees_through_noise():
    rng = np.random.default_rng(0)
    window, vector = SlidingWindow(), None
    for t in range(120):
        vector = window.push(sample(t, temp=25 + 0.2 * t / 60 + rng.normal(0, 0.1)))
    assert vector[FEATURES.index("temp_slope")] == pytest.approx(0.2, abs=0.05)


def test_the_window_keeps_only_its_last_120_s():
    window, vector = SlidingWindow(), None
    for t in range(300):
        # A step at 150 s: by 300 s the window holds only the new level.
        vector = window.push(sample(t, temp=30.0 if t >= 150 else 20.0))
    assert vector[FEATURES.index("temp_mean")] == 30.0
    assert vector[FEATURES.index("temp_slope")] == 0.0


def test_a_too_thin_window_gives_no_vector():
    # Enough snapshots, but over less than half the window.
    window = SlidingWindow()
    assert all(window.push(sample(t * 0.5)) is None for t in range(100))
    # Half the window, but too few snapshots.
    window = SlidingWindow()
    assert all(window.push(sample(t * 5)) is None for t in range(13))
    # 20 snapshots over 60 s: scored.
    window = SlidingWindow()
    vectors = [window.push(sample(t * 60 / 19)) for t in range(20)]
    assert all(v is None for v in vectors[:-1]) and vectors[-1] is not None


def test_after_a_gap_the_window_starts_over():
    window = SlidingWindow()
    for t in range(120):
        window.push(sample(t, temp=20.0))
    # 5 min without a snapshot: nothing from before the gap is left to make a trend with.
    after = [window.push(sample(420 + t, temp=30.0)) for t in range(61)]
    assert all(v is None for v in after[:60])
    assert after[60][FEATURES.index("temp_mean")] == 30.0


def test_a_gap_inside_the_window_still_scores():
    # Snapshots lost for 40 s in the middle: what is left still covers the window.
    window = SlidingWindow()
    vectors = [window.push(sample(t, temp=20 + t / 60)) for t in range(120) if not 40 <= t < 80]
    assert vectors[-1][FEATURES.index("temp_slope")] == pytest.approx(1.0)


def test_an_out_of_order_or_repeated_snapshot_is_ignored():
    window = SlidingWindow()
    for t in range(100):
        window.push(sample(t, temp=20 + t / 60))
    assert window.push(sample(50, temp=99.0)) is None  # from the past
    assert window.push(sample(99, temp=99.0)) is None  # a redelivery of the last one
    assert window.dropped == 2
    # The window goes on as if they had never come.
    assert window.push(sample(100, temp=20 + 100 / 60))[FEATURES.index("temp")] == pytest.approx(20 + 100 / 60)
    assert window.vector()[FEATURES.index("temp_slope")] == pytest.approx(1.0)


def test_windows_of_gives_what_the_live_window_gives():
    samples = [sample(t, temp=20 + math.sin(t / 30)) for t in range(400)]
    window = SlidingWindow()
    live = [v for v in map(window.push, samples) if v is not None]
    closing, vectors = windows_of(samples)
    assert np.array_equal(vectors, np.array(live))
    assert closing[0] == samples[60] and closing[-1] == samples[-1]


def test_a_telemetry_payload_becomes_a_sample():
    s = sample_of(payload("2026-10-06T08:00:01Z", temp=31.2, humidity=44, air=180))
    assert (s.temp, s.humidity, s.air) == (31.2, 44.0, 180.0)
    assert s.t == pytest.approx(1_791_273_601.0)
    # A ts the api accepts is kept as it came: the Alert lines up with its snapshot.
    assert s.ts == "2026-10-06T08:00:01Z"


def test_a_ts_the_api_would_refuse_is_normalised():
    assert sample_of(payload("2026-10-06T10:00:01+02:00")).ts == "2026-10-06T08:00:01.000Z"
    assert sample_of(payload("2026-10-06T08:00:01.25+00:00")).ts == "2026-10-06T08:00:01.250Z"


@pytest.mark.parametrize(
    "bad",
    [
        None,
        "not an object",
        {"sentinel": "sentinel-01", "ts": "2026-10-06T08:00:00Z"},  # no readings
        without("temp"),
        payload(temp=None),
        payload(humidity="44"),
        payload(air=True),  # a bool is no reading
        payload(temp=float("nan")),
        payload(air=float("inf")),
        payload(ts="yesterday"),
        payload(ts="2026-10-06T08:00:00"),  # no zone: a guess
        payload(ts="0001-01-01T00:00:00+01:00"),  # before year 1 in UTC
        payload(ts=1791273600),
        {"ts": "2026-10-06T08:00:00Z", "readings": [25.0, 45.0, 200]},
    ],
)
def test_an_invalid_payload_is_refused(bad):
    assert sample_of(bad) is None
