"""From a stream of telemetry snapshots to the vector the model scores.

Live and training go through the same SlidingWindow, so the model scores exactly what it learned
from. No threshold here: only the shape of the last minutes of Readings.
"""

import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

from sentinel_common.contract import alert_errors, iso_utc

# The enriched vector of ai/README.md: the Readings, how fast temp and air move, and where they
# sit on average over the window. The names are what a predictive Alert lists as its `drivers`
# (a closed vocabulary, docs/ARCHITECTURE.md): rename one and the dashboard's Twin stops following.
FEATURES = ("temp", "humidity", "air", "temp_slope", "air_slope", "temp_mean", "air_mean")

WINDOW_SECONDS = 120.0
MIN_SAMPLES = 20


@dataclass(frozen=True)
class Sample:
    """The Readings of one telemetry snapshot the model uses, at `t` seconds since the epoch."""

    t: float
    temp: float
    humidity: float
    air: float
    # The snapshot's ts, in the one format the api accepts: the Alert it may trigger carries it.
    ts: str


def _is_reading(value: object) -> bool:
    # bool is an int in Python (a `true` is no temperature), and a NaN would poison every mean.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _moment(ts: object) -> datetime | None:
    """The moment of an ISO 8601 timestamp, or None. A ts without an offset is refused: its zone
    is a guess, and a guess an hour off would bend every slope across it."""
    if not isinstance(ts, str):
        return None
    try:
        moment = datetime.fromisoformat(ts)
        return moment.astimezone(timezone.utc) if moment.tzinfo is not None else None
    except (ValueError, OverflowError):  # not a date, or one that falls off the calendar in UTC
        return None


def _alert_ts(ts: str, moment: datetime) -> str:
    # Kept as it came when the api takes it as is, so the Alert lines up with its snapshot in the
    # history; otherwise (an offset, no `Z`) the same moment in the api's format.
    return ts if not [e for e in alert_errors({"ts": ts}) if e.startswith("ts:")] else iso_utc(moment)


def sample_of(payload: object) -> Sample | None:
    """The Sample of a telemetry payload (docs/ARCHITECTURE.md), or None if it is not one."""
    if not isinstance(payload, dict) or not isinstance(payload.get("readings"), dict):
        return None
    readings = payload["readings"]
    values = [readings.get(name) for name in ("temp", "humidity", "air")]
    moment = _moment(payload.get("ts"))
    if moment is None or not all(map(_is_reading, values)):
        return None
    temp, humidity, air = (float(v) for v in values)
    return Sample(moment.timestamp(), temp, humidity, air, _alert_ts(payload["ts"], moment))


def slope_per_minute(t: np.ndarray, y: np.ndarray) -> float:
    """Least-squares slope of y over t, per minute: steady through the probes' noise, where the
    difference of two snapshots would be all noise."""
    dt = t - t.mean()
    spread = float(np.dot(dt, dt))
    return float(np.dot(dt, y - y.mean()) / spread * 60) if spread > 0 else 0.0


class SlidingWindow:
    """The last `seconds` of one Sentinel's Samples, and the feature vector they make."""

    def __init__(self, seconds: float = WINDOW_SECONDS, min_samples: int = MIN_SAMPLES):
        self.seconds = seconds
        # A slope over a handful of points, or over a few seconds, is noise: wait for the window
        # to hold enough Samples spread over at least half of it.
        self.min_samples = min_samples
        # Snapshots refused because they were not newer than the last one.
        self.dropped = 0
        self._samples: deque[Sample] = deque()

    def push(self, sample: Sample) -> np.ndarray | None:
        """Adds a Sample; returns the vector of the window, or None while it is too thin to score."""
        if self._samples and sample.t <= self._samples[-1].t:
            # A snapshot from the past (a delayed or redelivered one) would bend the slopes.
            self.dropped += 1
            return None
        self._samples.append(sample)
        while self._samples[0].t <= sample.t - self.seconds:
            self._samples.popleft()
        # After a gap the old Samples have left the window: the first few new ones make no trend.
        span = sample.t - self._samples[0].t
        if len(self._samples) < self.min_samples or span < self.seconds / 2:
            return None
        return self.vector()

    def vector(self) -> np.ndarray:
        """The vector of the window as it stands, in the order of FEATURES."""
        rows = np.array([(s.t, s.temp, s.humidity, s.air) for s in self._samples])
        t, temp, humidity, air = rows.T
        return np.array(
            [
                temp[-1],
                humidity[-1],
                air[-1],
                slope_per_minute(t, temp),
                slope_per_minute(t, air),
                temp.mean(),
                air.mean(),
            ]
        )


def windows_of(
    samples: list[Sample], seconds: float = WINDOW_SECONDS, min_samples: int = MIN_SAMPLES
) -> tuple[list[Sample], np.ndarray]:
    """Every vector a run of one Sentinel's Samples gives, in order, with the Sample that closed
    each window: what the model trains on, and what a replay scores in one go."""
    window = SlidingWindow(seconds, min_samples)
    closing, vectors = [], []
    for sample in samples:
        vector = window.push(sample)
        if vector is not None:
            closing.append(sample)
            vectors.append(vector)
    return closing, np.array(vectors).reshape(-1, len(FEATURES))
