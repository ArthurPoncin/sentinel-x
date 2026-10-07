"""From the detector's boxes to `intrusion` Alerts: one Alert while people are there, following them, cleared
when they leave.

The vision side of "one Alert = one change of state": a one-frame flash raises nothing, someone standing
still sends nothing, someone walking sends at most 2 Alerts a second on the same `alert_id`, so the Twin
moves the intruder without blinking and the api's rate limit is never reached.

Several people make one intrusion. One of them is followed, the nearest when the choice is made, and stays
the one for as long as they are seen: it is the one the Alert places (`x_norm`, `h_norm`, `bbox`) and the
camera turns to. The others are listed beside them, `others`, for the Twin to stand a figurine for each.

Pure: no camera, no model, no clock in the logic. The caller passes the monotonic time of each inference
and how far the camera was turned for it, so a sequence of detections always gives the same Alerts.
"""

import math
import uuid
from dataclasses import dataclass

from sentinel_common.contract import MAX_OTHERS, iso_utc

# Times and positions are floats: 0.7 - 0.2 is 0.49999999999999994, which is 500 ms all the same.
_EPSILON = 1e-9
# People kept from one inference to the next, far more than a camera frames at once: a detector gone
# wrong cannot grow the list without end.
_MOST_PEOPLE = 16


@dataclass(frozen=True)
class Detection:
    """A person the detector saw: its box in pixels of the captured image, and how sure it is.
    Keeping only the `person` label is the detector's job."""

    x: float
    y: float
    w: float
    h: float
    confidence: float


@dataclass(eq=False)
class _Person:
    """Someone the camera sees, from one inference to the next."""

    id: int
    # Where they stand around the camera, in degrees from where it rests, positive toward the right of
    # its image: the same whichever way the camera is turned.
    bearing: float
    # Where they were across the image when last seen, and how far the camera was turned then.
    x_norm: float
    pan: float
    # The share of the image's height their box took: twice as tall is half as far.
    h_norm: float
    confidence: float
    bbox: list[int]
    seen: float  # monotonic time of that sighting
    sightings: int = 1  # how many inferences saw them


def _is_count(value: object, minimum: int) -> bool:
    # bool is an int in Python: True is not a width.
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class IntruderTracker:
    """Turns each inference's detections into the Alerts to post.

    - one intrusion at a time, however many people make it: at most `max_people` are told, the one that
      is followed and the nearest of the others;
    - the person followed is the nearest, the tallest in the image, when nobody is followed yet; they stay
      the one for as long as they are seen, whoever comes nearer meanwhile;
    - a person is the same from one inference to the next when they are seen within `gate` degrees of
      where they were, and is still there for `hold` seconds after the detector last saw them: a miss of a
      frame or two takes nobody away;
    - `raised` once a person is seen on `confirm` inferences in a row;
    - `raised` again, same `alert_id`, when what the Alert tells has changed since the last one sent — the
      followed person or one of the others moved by `move_threshold` across the image or by
      `near_threshold` of its height, the camera turned by `pan_threshold` degrees, someone came or left,
      another person is followed — at most every `min_interval` seconds; a change made inside that
      interval is sent once it is over;
    - `cleared`, with the last known detail, once nobody has been seen for `clear_after` seconds. Whoever
      comes next gets a new `alert_id`.

    `fov` is the camera's horizontal field of view in degrees: what turns a place across the image into
    an angle, and back once the camera has turned.
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
        fov: float = 60.0,
        max_people: int = MAX_OTHERS + 1,
        hold: float = 1.0,
        gate: float | None = None,
        near_threshold: float = 0.08,
        pan_threshold: float = 3.0,
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
        if not (_is_number(fov) and 0 < fov < 180):
            raise ValueError(f"fov: a number in ]0, 180[ expected, got {fov!r}")
        if not (_is_count(max_people, 1) and max_people <= MAX_OTHERS + 1):
            raise ValueError(f"max_people: an integer from 1 to {MAX_OTHERS + 1} expected, got {max_people!r}")
        if not (_is_number(hold) and hold >= 0):
            raise ValueError(f"hold: a number >= 0 expected, got {hold!r}")
        if gate is not None and not (_is_number(gate) and gate > 0):
            raise ValueError(f"gate: a number > 0 expected, got {gate!r}")
        if not (_is_number(near_threshold) and 0 < near_threshold <= 1):
            raise ValueError(f"near_threshold: a number in ]0, 1] expected, got {near_threshold!r}")
        if not (_is_number(pan_threshold) and pan_threshold > 0):
            raise ValueError(f"pan_threshold: a number > 0 expected, got {pan_threshold!r}")
        self._width, self._height = width, height
        self._sentinel = sentinel
        self._confirm = confirm
        self._move_threshold = move_threshold
        self._min_interval = min_interval
        self._clear_after = clear_after
        self._fov = fov
        # Half the image's width, at the distance where a pixel across is a unit: what an angle off the
        # camera's axis is the tangent of.
        self._half_width = math.tan(math.radians(fov / 2))
        self._max_people = max_people
        self._hold = hold
        # A quarter of the field: further than anyone walks between two inferences, nearer than two people
        # stand apart.
        self._gate = fov / 4 if gate is None else gate
        self._near_threshold = near_threshold
        self._pan_threshold = pan_threshold

        self._streak = 0  # inferences in a row with a person
        self._last_seen: float | None = None  # when a person was last seen
        self._last_detail: dict | None = None  # who was there then, and where
        self._alert_id: str | None = None  # the Alert in progress, None when nobody is tracked
        self._sent: dict | None = None  # the detail of the last Alert sent
        self._sent_at = 0.0  # and when
        self._people: list[_Person] = []  # who the camera sees
        self._followed: _Person | None = None  # the one of them the Alert places
        self._next_id = 1
        self._updated: float | None = None  # when the last inference was

    @property
    def alert_id(self) -> str | None:
        """The `alert_id` of the intrusion in progress, None when there is none."""
        return self._alert_id

    @property
    def active(self) -> bool:
        """An intrusion was raised and not cleared yet."""
        return self._alert_id is not None

    @property
    def target(self) -> float | None:
        """Where the person followed stands, for the camera to turn to: degrees from where it rests,
        positive toward the right of its image. None while nobody is followed, and when the last
        inference did not see them: there is nothing new to turn to."""
        followed = self._followed
        return followed.bearing if followed is not None and followed.seen == self._updated else None

    @property
    def followed_box(self) -> list[int] | None:
        """The box of the person followed, as the last inference saw it: None when it did not."""
        followed = self._followed
        return list(followed.bbox) if followed is not None and followed.seen == self._updated else None

    def update(self, detections: list[Detection], now: float, ts: str | None = None, pan: float = 0.0) -> list[dict]:
        """After each inference: the people it found (empty when nobody), at monotonic time `now` in seconds,
        on an image taken with the camera turned by `pan` degrees from where it rests (positive toward
        the right of its image; 0 for a camera that does not turn).
        Returns the Alerts to post, oldest first: usually none, at most a `cleared` and a `raised`.
        `ts` is the Alert's timestamp, the wall-clock time of the inference; now when not given."""
        if not _is_number(pan):
            raise ValueError(f"pan: a number of degrees expected, got {pan!r}")
        alerts = self._expire(now, ts)
        # A NaN from the detector would make an Alert the api refuses.
        seen = [d for d in detections if all(map(_is_number, (d.x, d.y, d.w, d.h, d.confidence)))]
        self._updated = now
        self._sight(seen, now, pan)
        if seen:
            self._streak += 1
            self._last_seen = now
        else:
            self._streak = 0
        # Nobody left to tell of: the last known detail stays what it was.
        if self._followed is not None:
            self._last_detail = self._detail(pan)
        if self._alert_id is None:
            if seen and self._streak >= self._confirm:
                self._alert_id = f"vision-{uuid.uuid4().hex[:12]}"
                alerts.append(self._send("raised", now, ts))
            return alerts
        return alerts + self._follow(now, ts)

    def tick(self, now: float, ts: str | None = None) -> list[dict]:
        """Between inferences, or when they stall (the camera stuck, the model slow): clears the intrusion
        once `clear_after` has passed and sends a change held back by `min_interval`. The service may call
        it on a timer; `update` does the same first, so calling it is never required for correctness
        while inferences keep coming."""
        return self._expire(now, ts) + self._follow(now, ts)

    def _expire(self, now: float, ts: str | None) -> list[dict]:
        # Nobody seen for clear_after, whether inferences ran empty or did not run at all: they left.
        if self._last_seen is None or now - self._last_seen < self._clear_after - _EPSILON:
            return []
        alerts = [self._send("cleared", now, ts)] if self._alert_id is not None else []
        self._alert_id, self._last_seen, self._last_detail, self._sent = None, None, None, None
        self._people, self._followed, self._next_id = [], None, 1
        # Whoever comes next is confirmed afresh, not by a sighting from before the gap.
        self._streak = 0
        return alerts

    def _follow(self, now: float, ts: str | None) -> list[dict]:
        # Compared with the last Alert sent, not the last frame: a slow walk adds up to a move, and a change
        # held back by min_interval is still there to send at the next call, unless it was undone.
        if self._alert_id is None or self._last_detail is None or self._sent is None:
            return []
        if not self._changed(self._last_detail, self._sent) or now - self._sent_at < self._min_interval - _EPSILON:
            return []
        return [self._send("raised", now, ts)]

    def _changed(self, detail: dict, sent: dict) -> bool:
        if detail["id"] != sent["id"] or abs(detail["pan"] - sent["pan"]) >= self._pan_threshold - _EPSILON:
            return True
        were = {other["id"]: other for other in sent["others"]}
        if were.keys() != {other["id"] for other in detail["others"]}:
            return True
        return any(
            abs(person["x_norm"] - was["x_norm"]) >= self._move_threshold - _EPSILON
            or abs(person["h_norm"] - was["h_norm"]) >= self._near_threshold - _EPSILON
            for person, was in [(detail, sent), *((other, were[other["id"]]) for other in detail["others"])]
        )

    def _off_axis(self, x_norm: float) -> float:
        # A lens spreads its image evenly over a plane, not over an angle.
        return math.degrees(math.atan((2 * x_norm - 1) * self._half_width))

    def _sight(self, seen: list[Detection], now: float, pan: float) -> None:
        """Who the camera sees after this inference: each detection is the person it is nearest to, if
        near enough, or someone new."""
        sightings = []
        for d in seen:
            # From the box's centre, clamped: a box the model draws past the edge is still at the edge.
            x_norm = min(max((d.x + d.w / 2) / self._width, 0.0), 1.0)
            # The box, clipped to the image, in whole pixels of the captured frame.
            left, top = min(max(d.x, 0.0), self._width), min(max(d.y, 0.0), self._height)
            right, bottom = min(max(d.x + d.w, left), self._width), min(max(d.y + d.h, top), self._height)
            bbox = [round(left), round(top), round(right) - round(left), round(bottom) - round(top)]
            sightings.append((pan + self._off_axis(x_norm), x_norm, (bottom - top) / self._height, d.confidence, bbox))

        # The nearest pairs first: each person and each detection is taken once.
        pairs = sorted(
            (abs(person.bearing - sighting[0]), index, found)
            for index, person in enumerate(self._people)
            for found, sighting in enumerate(sightings)
            if abs(person.bearing - sighting[0]) <= self._gate + _EPSILON
        )
        seen_as: dict[int, int] = {}  # which detection each person is
        for _, index, found in pairs:
            if index not in seen_as and found not in seen_as.values():
                seen_as[index] = found
        # One person left without a detection and one detection left without a person: the same one, who
        # went further than the gate since the last inference. Not someone lost for longer than the hold:
        # what is seen elsewhere by then is someone else, or nobody.
        missed = [index for index in range(len(self._people)) if index not in seen_as]
        unclaimed = [found for found in range(len(sightings)) if found not in seen_as.values()]
        if len(missed) == 1 and len(unclaimed) == 1 and now - self._people[missed[0]].seen < self._hold - _EPSILON:
            seen_as[missed[0]] = unclaimed[0]
        for index, found in seen_as.items():
            person = self._people[index]
            person.bearing, person.x_norm, person.h_norm, person.confidence, person.bbox = sightings[found]
            person.pan, person.seen = pan, now
            person.sightings += 1
        for found, (bearing, x_norm, h_norm, confidence, bbox) in enumerate(sightings):
            if found not in seen_as.values():
                self._people.append(_Person(self._next_id, bearing, x_norm, pan, h_norm, confidence, bbox, now))
                self._next_id += 1

        followed = self._followed
        others = [person for person in self._people if person is not followed and self._still_there(person, now, pan)]
        # The nearest first; of two as near, the one the detector is surest of.
        others.sort(key=lambda person: (-person.h_norm, -person.confidence))
        del others[_MOST_PEOPLE - 1 :]
        if followed is not None and not self._still_there(followed, now, pan):
            # No longer seen. They stay the one the Alert tells of, where they last were, until someone
            # else can be: someone seen often enough to be a person, unless they were not one themselves.
            heir = next((p for p in others if p.sightings >= self._confirm or followed.sightings < self._confirm), None)
            if heir is not None:
                followed = None
        if followed is None and others:
            followed = next((person for person in others if person.sightings >= self._confirm), others[0])
            others.remove(followed)
        self._followed = followed
        self._people = ([followed] if followed is not None else []) + others

    def _still_there(self, person: _Person, now: float, pan: float) -> bool:
        if person.seen == now:
            return True
        # Seen once and not again: a flash, nobody to hold on to.
        if person.sightings < self._confirm:
            return False
        # Out of what the camera now frames, it cannot say they are still there.
        return now - person.seen < self._hold - _EPSILON and abs(person.bearing - pan) <= self._fov / 2

    def _across(self, person: _Person, pan: float) -> float:
        """Where `person` is across the image of a camera turned by `pan`: where they were seen, or where
        that is now that the camera has turned."""
        if pan == person.pan:
            return person.x_norm
        off_axis = min(max(person.bearing - pan, -89.0), 89.0)
        return min(max(0.5 + math.tan(math.radians(off_axis)) / (2 * self._half_width), 0.0), 1.0)

    def _detail(self, pan: float) -> dict:
        followed = self._followed
        assert followed is not None
        # Those seen often enough to be someone, the nearest first.
        others = sorted(
            (person for person in self._people if person is not followed and person.sightings >= self._confirm),
            key=lambda person: (-person.h_norm, person.id),
        )
        return {
            "x_norm": round(self._across(followed, pan), 3),
            "confidence": round(followed.confidence, 3),
            "bbox": list(followed.bbox),
            "id": followed.id,
            "h_norm": round(followed.h_norm, 3),
            "pan": round(pan, 1),
            "others": [
                {
                    "id": person.id,
                    "x_norm": round(self._across(person, pan), 3),
                    "h_norm": round(person.h_norm, 3),
                    "confidence": round(person.confidence, 3),
                }
                for person in others[: self._max_people - 1]
            ],
        }

    def _send(self, state: str, now: float, ts: str | None) -> dict:
        detail = self._last_detail
        assert self._alert_id is not None and detail is not None
        if state == "raised":
            self._sent, self._sent_at = detail, now
        return {
            "alert_id": self._alert_id,
            "sentinel": self._sentinel,
            "kind": "intrusion",
            "severity": "critical",
            "state": state,
            # A copy: the caller may keep or change the Alert, the tracker keeps its own.
            "detail": {**detail, "bbox": list(detail["bbox"]), "others": [dict(other) for other in detail["others"]]},
            "ts": ts if ts is not None else iso_utc(),
        }
