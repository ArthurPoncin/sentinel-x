"""The reference tests of #69: nominal stays quiet, a slow drift is caught before the firmware."""

from datetime import datetime

import pytest

from sentinel_common.contract import alert_errors

from predictive import simulate, synthetic
from predictive.__main__ import main
from predictive.detector import replay
from predictive.features import sample_of

# The pinned lead over the first of THERMAL_WARNING / GAS_WARNING. The reference run gets ~43 min,
# and no seed tried got under ~36: 20 min leaves room to retune the synthetic room, and is still
# plenty for an Operator to act.
MIN_LEAD_S = 20 * 60


def epoch(ts):
    return datetime.fromisoformat(ts).timestamp()


@pytest.fixture(scope="module")
def outcome(model):
    return simulate.run(model, seed=1)


@pytest.mark.parametrize("seed", [100, 101, 102])
def test_an_hour_of_unseen_nominal_raises_nothing(model, seed):
    # Another seed than the training's: other cycles, drafts and noise, the same room.
    samples = [sample_of(p) for p in synthetic.nominal(3600, seed, synthetic.START.replace(hour=14))]
    assert replay(model, samples, "sentinel-01") == []


def test_the_reference_drift_is_raised_before_the_sentinel_thresholds(outcome):
    raised = [a for a in outcome.alerts if a["state"] == "raised"]
    assert len(raised) == 1
    assert outcome.thermal_at is not None and outcome.gas_at is not None
    assert outcome.scenario.drift_from < outcome.raised_at
    assert outcome.raised_at + MIN_LEAD_S <= min(outcome.thermal_at, outcome.gas_at)


def test_the_reference_drift_clears_after_the_return_to_rest(outcome):
    raised, cleared = outcome.alerts
    assert (raised["state"], cleared["state"]) == ("raised", "cleared")
    assert raised["alert_id"] == cleared["alert_id"]
    # Not while the drift is still there, and not long after it is gone.
    assert outcome.scenario.nominal_from < outcome.cleared_at < outcome.scenario.nominal_from + 5 * 60


def test_every_alert_follows_the_contract(outcome):
    assert outcome.alerts
    for alert in outcome.alerts:
        assert alert_errors(alert) == []
        assert alert["sentinel"] == "sentinel-01" and alert["kind"] == "predictive"
        assert 0 < alert["detail"]["anomaly_score"] < 1
        assert 1 <= len(alert["detail"]["drivers"]) <= 3


def test_the_raised_alert_carries_its_snapshot_ts(outcome):
    raised = outcome.alerts[0]
    assert raised["ts"] in {p["ts"] for p in outcome.scenario.payloads}
    assert epoch(raised["ts"]) == outcome.raised_at


def test_the_synthetic_telemetry_is_deterministic():
    assert synthetic.nominal(600, seed=7) == synthetic.nominal(600, seed=7)
    assert synthetic.nominal(600, seed=7) != synthetic.nominal(600, seed=8)


def test_simulate_prints_the_lead(capsys):
    main(["simulate"])
    out = capsys.readouterr().out
    assert "predictive raised" in out and "predictive cleared" in out
    assert "Lead over the Sentinel's first threshold:" in out
