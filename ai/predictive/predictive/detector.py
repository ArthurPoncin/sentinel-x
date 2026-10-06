"""When a stream of scores becomes an Alert: one `raised` when the drift sets in, one `cleared`
when it is gone, nothing in between (an Alert is a change of state)."""

import uuid
from dataclasses import dataclass

from .features import Sample, windows_of
from .model import Model, Verdict

RAISE_AFTER = 5
CLEAR_AFTER = 10


@dataclass(frozen=True)
class Transition:
    state: str  # raised | cleared
    alert_id: str
    verdict: Verdict
    # The snapshot that tipped it: the Alert carries its ts.
    sample: Sample


class DriftDetector:
    """One Sentinel's predictive state. `raise_after` scores in a row at or above the raise level
    raise it, `clear_after` in a row under the clear level clear it: a lone odd window, or a score
    hovering around a level, never flaps the Alert."""

    def __init__(
        self, raise_level: float, clear_level: float, raise_after: int = RAISE_AFTER, clear_after: int = CLEAR_AFTER
    ):
        self.raise_level = raise_level
        self.clear_level = clear_level
        self.raise_after = raise_after
        self.clear_after = clear_after
        self.alert_id: str | None = None
        self._streak = 0

    @property
    def raised(self) -> bool:
        return self.alert_id is not None

    def observe(self, verdict: Verdict, sample: Sample) -> Transition | None:
        if not self.raised:
            self._streak = self._streak + 1 if verdict.anomaly_score >= self.raise_level else 0
            if self._streak >= self.raise_after:
                self._streak = 0
                # One id per episode: it pairs this raised with its cleared in the history.
                self.alert_id = f"predictive-{uuid.uuid4().hex[:12]}"
                return Transition("raised", self.alert_id, verdict, sample)
        else:
            self._streak = self._streak + 1 if verdict.anomaly_score < self.clear_level else 0
            if self._streak >= self.clear_after:
                alert_id, self.alert_id, self._streak = self.alert_id, None, 0
                return Transition("cleared", alert_id, verdict, sample)
        return None


def alert_of(transition: Transition, sentinel: str) -> dict:
    """The Alert of a transition, as POST /api/v1/alerts takes it (docs/ARCHITECTURE.md). The api
    sets `source` from the token."""
    return {
        "alert_id": transition.alert_id,
        "sentinel": sentinel,
        "kind": "predictive",
        "severity": "warning",
        "state": transition.state,
        "detail": {
            "anomaly_score": round(transition.verdict.anomaly_score, 3),
            "drivers": list(transition.verdict.drivers),
        },
        "ts": transition.sample.ts,
    }


class Monitor:
    """What the live service keeps per Sentinel: its window and its predictive state. One Sample
    in, at most one Alert out."""

    def __init__(self, model: Model, sentinel: str, raise_after: int = RAISE_AFTER, clear_after: int = CLEAR_AFTER):
        self.model = model
        self.sentinel = sentinel
        self.window = model.window()
        self.detector = DriftDetector(model.raise_level, model.clear_level, raise_after, clear_after)

    def push(self, sample: Sample) -> dict | None:
        vector = self.window.push(sample)
        if vector is None:
            return None
        transition = self.detector.observe(self.model.judge(vector)[0], sample)
        return alert_of(transition, self.sentinel) if transition else None


def replay(
    model: Model, samples: list[Sample], sentinel: str, raise_after: int = RAISE_AFTER, clear_after: int = CLEAR_AFTER
) -> list[dict]:
    """The Alerts a Monitor would emit on these Samples, in order: the same window, scores and
    state machine, with the scoring batched so an hour replays in a fraction of a second."""
    closing, vectors = windows_of(samples, model.window_seconds, model.min_samples)
    detector = DriftDetector(model.raise_level, model.clear_level, raise_after, clear_after)
    transitions = (detector.observe(v, s) for v, s in zip(model.judge(vectors), closing))
    return [alert_of(t, sentinel) for t in transitions if t]
