"""From the detector's boxes to `intrusion` Alerts: one Alert per intruder, following them, cleared when they leave.

The vision side of "one Alert = one change of state": a one-frame flash raises nothing, someone standing
still sends nothing, someone walking sends at most 2 Alerts a second on the same `alert_id`, so the Twin
moves the intruder without blinking and the api's rate limit is never reached.

Pure: no camera, no model, no clock in the logic. The caller passes the monotonic time of each inference,
so a sequence of detections always gives the same Alerts.
"""

import math
import uuid
from dataclasses import dataclass

from sentinel_common.contract import iso_utc

# Times and positions are floats: 0.7 - 0.2 is 0.49999999999999994, which is 500 ms all the same.
_EPSILON = 1e-9


@dataclass(frozen=True)
class Detection:
    """A person the detector saw: its box in pixels of the captured image, and how sure it is.
    Keeping only the `person` label is the detector's job."""

    x: float
    y: float
    w: float
    h: float
    confidence: float


def _is_count(value: object, minimum: int) -> bool:
    # bool is an int in Python: True is not a width.
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class IntruderTracker:
    """Turns each inference's detections into the Alerts to post.

    - one intruder at a time, the most confident person;
    - `raised` once a person is seen on `confirm` inferences in a row;
    - `raised` again, same `alert_id`, when `x_norm` moved by `move_threshold` since the last Alert sent,
      at most every `min_interval` seconds; a move made inside that interval is sent once it is over;
    - `cleared`, with the last known detail, once nobody has been seen for `clear_after` seconds. Whoever
      comes next gets a new `alert_id`.
    """

    def __init__(
        self,
        width: int,
        height: int,
        *,
        sentinel: str = "sentinel-01",
        confirm: int = 2,
        move_threshold: float = 0.05,
        min_interval: float = 0.5,
        clear_after: float = 3.0,
    ) -> None:
        if not (_is_count(width, 1) and _is_count(height, 1)):
            raise ValueError(f"width and height: positive integers expected, got {width!r} x {height!r}")
        if not (isinstance(sentinel, str) and sentinel):
            raise ValueError(f"sentinel: a non-empty string expected, got {sentinel!r}")
        if not _is_count(confirm, 1):
            raise ValueError(f"confirm: an integer >= 1 expected, got {confirm!r}")
        if not (_is_number(move_threshold) and 0 < move_threshold <= 1):
            raise ValueError(f"move_threshold: a number in ]0, 1] expected, got {move_threshold!r}")
        if not (_is_number(min_interval) and min_interval >= 0):
            raise ValueError(f"min_interval: a number >= 0 expected, got {min_interval!r}")
        if not (_is_number(clear_after) and clear_after > 0):
            raise ValueError(f"clear_after: a number > 0 expected, got {clear_after!r}")
        self._width, self._height = width, height
        self._sentinel = sentinel
        self._confirm = confirm
        self._move_threshold = move_threshold
        self._min_interval = min_interval
        self._clear_after = clear_after

        self._streak = 0  # inferences in a row with a person
        self._last_seen: float | None = None  # when a person was last seen
        self._last_detail: dict | None = None  # where they were then
        self._alert_id: str | None = None  # the Alert in progress, None when nobody is tracked
        self._sent_x = 0.0  # x_norm of the last Alert sent
        self._sent_at = 0.0  # and when

    @property
    def alert_id(self) -> str | None:
        """The `alert_id` of the intrusion in progress, None when there is none."""
        return self._alert_id

    @property
    def active(self) -> bool:
        """An intrusion was raised and not cleared yet."""
        return self._alert_id is not None

    def update(self, detections: list[Detection], now: float, ts: str | None = None) -> list[dict]:
        """After each inference: the people it found (empty when nobody), at monotonic time `now` in seconds.
        Returns the Alerts to post, oldest first: usually none, at most a `cleared` and a `raised`.
        `ts` is the Alert's timestamp, the wall-clock time of the inference; now when not given."""
        alerts = self._expire(now, ts)
        # A NaN from the detector would make an Alert the api refuses.
        seen = [d for d in detections if all(map(_is_number, (d.x, d.y, d.w, d.h, d.confidence)))]
        if not seen:
            self._streak = 0
            return alerts
        self._streak += 1
        self._last_seen = now
        self._last_detail = self._detail(max(seen, key=lambda d: d.confidence))
        if self._alert_id is None:
            if self._streak >= self._confirm:
                self._alert_id = f"vision-{uuid.uuid4().hex[:12]}"
                alerts.append(self._send("raised", now, ts))
            return alerts
        return alerts + self._follow(now, ts)

    def tick(self, now: float, ts: str | None = None) -> list[dict]:
        """Between inferences, or when they stall (the camera stuck, the model slow): clears the intrusion
        once `clear_after` has passed and sends a move held back by `min_interval`. The service may call
        it on a timer; `update` does the same first, so calling it is never required for correctness
        while inferences keep coming."""
        return self._expire(now, ts) + self._follow(now, ts)

    def _expire(self, now: float, ts: str | None) -> list[dict]:
        # Nobody seen for clear_after, whether inferences ran empty or did not run at all: they left.
        if self._last_seen is None or now - self._last_seen < self._clear_after - _EPSILON:
            return []
        alerts = [self._send("cleared", now, ts)] if self._alert_id is not None else []
        self._alert_id, self._last_seen, self._last_detail = None, None, None
        # Whoever comes next is confirmed afresh, not by a sighting from before the gap.
        self._streak = 0
        return alerts

    def _follow(self, now: float, ts: str | None) -> list[dict]:
        # Compared with the last Alert sent, not the last frame: a slow walk adds up to a move, and a move
        # held back by min_interval is still there to send at the next call, unless they came back.
        if self._alert_id is None or self._last_detail is None:
            return []
        moved = abs(self._last_detail["x_norm"] - self._sent_x) >= self._move_threshold - _EPSILON
        if not moved or now - self._sent_at < self._min_interval - _EPSILON:
            return []
        return [self._send("raised", now, ts)]

    def _detail(self, d: Detection) -> dict:
        # x_norm from the box's centre, clamped: a box the model draws past the edge is still at the edge.
        x_norm = min(max((d.x + d.w / 2) / self._width, 0.0), 1.0)
        # The box, clipped to the image, in whole pixels of the captured frame.
        left, top = min(max(d.x, 0.0), self._width), min(max(d.y, 0.0), self._height)
        right, bottom = min(max(d.x + d.w, left), self._width), min(max(d.y + d.h, top), self._height)
        bbox = [round(left), round(top), round(right) - round(left), round(bottom) - round(top)]
        return {"x_norm": round(x_norm, 3), "confidence": round(d.confidence, 3), "bbox": bbox}

    def _send(self, state: str, now: float, ts: str | None) -> dict:
        detail = self._last_detail
        assert self._alert_id is not None and detail is not None
        if state == "raised":
            self._sent_x, self._sent_at = detail["x_norm"], now
        return {
            "alert_id": self._alert_id,
            "sentinel": self._sentinel,
            "kind": "intrusion",
            "severity": "critical",
            "state": state,
            # A copy: the caller may keep or change the Alert, the tracker keeps its own.
            "detail": {**detail, "bbox": list(detail["bbox"])},
            "ts": ts if ts is not None else iso_utc(),
        }
