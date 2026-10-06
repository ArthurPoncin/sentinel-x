"""`python -m predictive simulate`: the model's lead over the Sentinel's thresholds, without a
Sentinel. Train on 2 h of synthetic nominal, replay a slow heat + gas drift, and tell when the
predictive Alert is raised against when the firmware would have raised its own.

The rehearsal of the demo's beat, and the reference test: the same run, seeded, every time.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import synthetic
from .detector import replay
from .features import sample_of, windows_of
from .model import Model, train

# firmware/include/config.h. Only to measure the lead: nothing in the model ever looks at them.
THERMAL_WARNING = 40.0  # °C
GAS_WARNING = 1500  # MQ-2 raw counts

TRAIN_HOURS = 2


def _epoch(ts: str) -> float:
    return datetime.fromisoformat(ts).timestamp()


def nominal_model(seed: int = 0, hours: float = TRAIN_HOURS) -> Model:
    """A model trained on `hours` of synthetic nominal telemetry."""
    payloads = synthetic.nominal(round(hours * 3600), seed)
    samples = [sample_of(p) for p in payloads]
    _, vectors = windows_of(samples)
    return train(vectors, data_from=payloads[0]["ts"], data_to=payloads[-1]["ts"])


@dataclass(frozen=True)
class Outcome:
    model: Model
    scenario: synthetic.Scenario
    alerts: list[dict]
    # Seconds since the epoch at which the firmware's thresholds are first reached, if ever.
    thermal_at: float | None
    gas_at: float | None

    @property
    def raised_at(self) -> float | None:
        return next((_epoch(a["ts"]) for a in self.alerts if a["state"] == "raised"), None)

    @property
    def cleared_at(self) -> float | None:
        return next((_epoch(a["ts"]) for a in self.alerts if a["state"] == "cleared"), None)

    @property
    def lead(self) -> float | None:
        """Seconds between the predictive Alert and the first of the firmware's thresholds."""
        reached = [t for t in (self.thermal_at, self.gas_at) if t is not None]
        return min(reached) - self.raised_at if reached and self.raised_at is not None else None


def run(model: Model | None = None, train_seed: int = 0, seed: int = 1) -> Outcome:
    """Replays the reference drift (seeded `seed`, never seen in training) through `model`, or
    through one trained on synthetic nominal seeded `train_seed`."""
    model = model or nominal_model(train_seed)
    # Right after the training capture: the same room, an hour it has not seen.
    start = synthetic.START + timedelta(hours=TRAIN_HOURS)
    scenario = synthetic.drift(seed, start)
    samples = [sample_of(p) for p in scenario.payloads]
    return Outcome(
        model,
        scenario,
        replay(model, samples, synthetic.SENTINEL),
        thermal_at=next((s.t for s in samples if s.temp >= THERMAL_WARNING), None),
        gas_at=next((s.t for s in samples if s.air >= GAS_WARNING), None),
    )


def _clock(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%H:%M:%S")


def _span(seconds: float) -> str:
    minutes, seconds = divmod(round(abs(seconds)), 60)
    return f"{minutes} min {seconds:02d} s"


def report(outcome: Outcome) -> str:
    """What `simulate` prints: the run, event by event, and the lead."""
    model, scenario, raised_at = outcome.model, outcome.scenario, outcome.raised_at
    readings = {_epoch(p["ts"]): p["readings"] for p in scenario.payloads}
    events = [(scenario.drift_from, "heat + gas start drifting"), (scenario.nominal_from, "the room is back at rest")]
    for alert in outcome.alerts:
        at, detail = _epoch(alert["ts"]), alert["detail"]
        line = f"predictive {alert['state']}, score {detail['anomaly_score']:.3f}, drivers {', '.join(detail['drivers'])}"
        if alert["state"] == "raised":
            line += f": {_span(at - scenario.drift_from)} into the drift, at {readings[at]['temp']:g} °C and air {readings[at]['air']}"
        elif at >= scenario.nominal_from:
            line += f": {_span(at - scenario.nominal_from)} after the return to rest"
        events.append((at, line))
    for at, line in (
        (outcome.thermal_at, f"temp reaches {THERMAL_WARNING:g} °C (THERMAL_WARNING)"),
        (outcome.gas_at, f"air reaches {GAS_WARNING} (GAS_WARNING)"),
    ):
        if at is not None and raised_at is not None:
            line += f": the predictive Alert came {_span(at - raised_at)} {'before' if at >= raised_at else 'after'}"
        if at is not None:
            events.append((at, line))
    lead = outcome.lead
    return "\n".join(
        [
            f"Trained on {TRAIN_HOURS} h of synthetic nominal telemetry ({model.trained_on} vectors): "
            f"raise at {model.raise_level:.3f}, clear under {model.clear_level:.3f} (learned quantiles)."
        ]
        + [f"{_clock(at)}  {line}" for at, line in sorted(events, key=lambda e: e[0])]
        + [
            f"Lead over the Sentinel's first threshold: {_span(lead)}."
            if lead is not None and lead > 0
            else "No lead: the predictive Alert did not come before the Sentinel's thresholds."
        ]
    )
