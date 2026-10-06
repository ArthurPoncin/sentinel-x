"""Synthetic telemetry, for the tests and the simulator: the model is trained and its lead time
measured before the Sentinel has captured a single nominal hour.

Snapshots shaped as the Sentinel publishes them (docs/ARCHITECTURE.md), one per second
(CYCLE_MS), with what makes real probes hard: the room's own cycles, drafts, sensor noise, the
DHT22's 0.1 resolution, the MQ-2's integer ADC counts, a humidity that falls and a gas reading
that rises as the air warms up. Seeded: the same seed gives the same snapshots, to the last digit.

The room at rest is stationary and bounded: cycles of a fixed period (ventilation, heating), plus
drafts that pass in a minute. That is what makes 2 h of it representative of any other hour, as
the Tuesday capture must be of the demo: a nominal that wanders slowly and without bound (a random
walk over hours) leaves every hour a fair chance of going where the capture never went, and the
Isolation Forest rightly finds that odd.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

START = datetime(2026, 10, 6, 8, 0, tzinfo=timezone.utc)
SENTINEL = "sentinel-01"

# Where each Reading sits at rest, (amplitude, period in minutes) of its cycle, (standard deviation,
# minutes) of its drafts, and the probe's own noise.
TEMP = dict(base=26.5, cycle=(0.5, 24), drafts=(0.05, 1), noise=0.1)  # °C
HUMIDITY = dict(base=45.0, cycle=(0.0, 1), drafts=(0.1, 1), noise=0.3)  # %, no cycle of its own: see below
AIR = dict(base=250.0, cycle=(50.0, 11), drafts=(5.0, 1), noise=8.0)  # MQ-2 raw counts
# RH falls when the air warms at constant moisture; the MQ-2 reads higher as it warms.
HUMIDITY_PER_DEGREE = -0.8
AIR_PER_DEGREE = 10.0

# The reference drift: heat rising steadily, gas building up slowly then faster and faster.
DRIFT_TEMP_PER_MINUTE = 0.3
DRIFT_AIR_AT_PEAK = 1500.0


def _drafts(rng: np.random.Generator, seconds: int, std: float, minutes: float) -> np.ndarray:
    """White noise smoothed over about `minutes`, scaled to `std`: the room moves, it does not
    jump (only the probes add noise from one second to the next)."""
    width = minutes * 60
    kernel = np.exp(-0.5 * (np.arange(-3 * width, 3 * width + 1) / width) ** 2)
    smooth = np.convolve(rng.normal(0, 1, seconds + len(kernel) - 1), kernel, mode="valid")
    return std * smooth / np.sqrt(np.sum(kernel**2))


def _at_rest(rng: np.random.Generator, t: np.ndarray, reading: dict) -> np.ndarray:
    amplitude, minutes = reading["cycle"]
    cycle = amplitude * np.sin(2 * np.pi * t / (minutes * 60) + rng.uniform(0, 2 * np.pi))
    return reading["base"] + cycle + _drafts(rng, len(t), *reading["drafts"])


def telemetry(
    seconds: int,
    seed: int,
    start: datetime = START,
    temp_offset: np.ndarray | None = None,
    air_offset: np.ndarray | None = None,
) -> list[dict]:
    """`seconds` of telemetry snapshots, one per second from `start`: the room at rest, plus the
    given offsets (one value per second) on temp and air when something goes wrong."""
    rng = np.random.default_rng(seed)
    t = np.arange(seconds, dtype=float)
    temp = _at_rest(rng, t, TEMP) + (0 if temp_offset is None else temp_offset)
    warmer = temp - TEMP["base"]
    humidity = _at_rest(rng, t, HUMIDITY) + HUMIDITY_PER_DEGREE * warmer
    air = _at_rest(rng, t, AIR) + AIR_PER_DEGREE * warmer + (0 if air_offset is None else air_offset)
    # The probes: their noise, then what their resolution keeps of it.
    temp = np.round(temp + rng.normal(0, TEMP["noise"], seconds), 1)
    humidity = np.round(np.clip(humidity + rng.normal(0, HUMIDITY["noise"], seconds), 0, 100), 1)
    air = np.round(np.clip(air + rng.normal(0, AIR["noise"], seconds), 0, 4095))
    payloads = []
    for second, c, h, a in zip(t, temp, humidity, air):
        # The Sentinel's format: whole seconds, `Z`.
        ts = (start + timedelta(seconds=float(second))).strftime("%Y-%m-%dT%H:%M:%SZ")
        readings = {"temp": float(c), "humidity": float(h), "air": int(a), "pir": False, "sound": 0.02}
        payloads.append({"sentinel": SENTINEL, "ts": ts, "readings": readings})
    return payloads


def nominal(seconds: int, seed: int, start: datetime = START) -> list[dict]:
    """The room at rest, nothing going wrong."""
    return telemetry(seconds, seed, start)


@dataclass(frozen=True)
class Scenario:
    payloads: list[dict]
    # Seconds since the epoch: when the drift starts, when it is at its worst, when it is all gone.
    drift_from: float
    peak_at: float
    nominal_from: float


def drift(
    seed: int,
    start: datetime = START,
    lead_in_minutes: float = 10,
    rise_minutes: float = 60,
    fall_minutes: float = 15,
    tail_minutes: float = 20,
) -> Scenario:
    """The reference scenario: the room at rest, then heat rising steadily (+18 °C over the hour)
    with gas building up slowly then faster, both past THERMAL_WARNING and GAS_WARNING by the
    peak; then back to rest over `fall_minutes` (ventilation, a door opened) and at rest again."""
    lead_in, rise, fall, tail = (round(m * 60) for m in (lead_in_minutes, rise_minutes, fall_minutes, tail_minutes))
    t = np.arange(lead_in + rise + fall + tail, dtype=float)
    # 0 at rest, 1 at the peak: up, then back down linearly.
    shape = np.interp(t, [0, lead_in, lead_in + rise, lead_in + rise + fall, len(t)], [0, 0, 1, 0, 0])
    temp_offset = DRIFT_TEMP_PER_MINUTE * rise_minutes * shape
    # A whiff of gas at first, then faster as the heat goes on: quadratic on the way up.
    air_offset = DRIFT_AIR_AT_PEAK * np.where(t < lead_in + rise, shape**2, shape)
    epoch = start.timestamp()
    return Scenario(
        telemetry(len(t), seed, start, temp_offset, air_offset),
        drift_from=epoch + lead_in,
        peak_at=epoch + lead_in + rise,
        nominal_from=epoch + lead_in + rise + fall,
    )
