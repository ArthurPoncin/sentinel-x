from datetime import datetime, timedelta, timezone

import pytest

from sentinel_common.contract import alert_errors, iso_utc


def intrusion(**changes):
    alert = {
        "alert_id": "vision-1",
        "sentinel": "sentinel-01",
        "kind": "intrusion",
        "severity": "critical",
        "state": "raised",
        "detail": {"x_norm": 0.42, "confidence": 0.88, "bbox": [120, 80, 60, 180]},
        "ts": "2026-10-05T14:23:05Z",
    }
    return {**alert, **changes}


def predictive(**changes):
    alert = {
        "alert_id": "predictive-1",
        "sentinel": "sentinel-01",
        "kind": "predictive",
        "severity": "warning",
        "state": "raised",
        "detail": {"anomaly_score": 0.91, "drivers": ["temp_slope", "air_slope"]},
        "ts": "2026-10-05T14:23:05.250Z",
    }
    return {**alert, **changes}


def test_accepts_the_examples_of_the_architecture():
    assert alert_errors(intrusion()) == []
    assert alert_errors(predictive()) == []
    assert alert_errors(predictive(source="predictive", value=0.91)) == []


def seen(**changes):
    """An intrusion's detail, with what `changes` add to it or replace in it."""
    return intrusion(detail={**intrusion()["detail"], **changes})


def other(**changes):
    return {"id": 4, "x_norm": 0.81, "h_norm": 0.33, "confidence": 0.71, **changes}


def test_accepts_an_intrusion_seen_by_a_camera_that_turns():
    assert alert_errors(seen(id=3, h_norm=0.61, pan=-35.5, others=[other()])) == []
    assert alert_errors(seen(pan=0, others=[])) == []
    assert alert_errors(seen(others=[other(id=n) for n in range(4)])) == []


@pytest.mark.parametrize(
    "alert",
    [
        seen(h_norm=1.4),
        seen(pan=200),
        seen(pan=True),
        seen(id=1.5),
        seen(id=-1),
        seen(others=other()),
        seen(others=[other(id=n) for n in range(5)]),
        seen(others=[other(x_norm=-0.1)]),
        seen(others=[other(bbox=[0, 0, 1, 1])]),
        seen(others=[{key: value for key, value in other().items() if key != "h_norm"}]),
        seen(others=[other(confidence=float("nan"))]),
    ],
)
def test_refuses_what_the_api_refuses_of_a_camera_that_turns(alert):
    assert alert_errors(alert) != []


@pytest.mark.parametrize(
    "alert",
    [
        intrusion(extra=1),
        {key: value for key, value in intrusion().items() if key != "alert_id"},
        intrusion(alert_id=""),
        intrusion(kind="smoke"),
        intrusion(severity="high"),
        intrusion(state="ongoing"),
        intrusion(source="laptop"),
        intrusion(value=True),
        intrusion(ts="2026-10-05T14:23:05+00:00"),
        intrusion(ts="2026-10-05 14:23:05Z"),
        intrusion(detail={"x_norm": 1.2, "confidence": 0.9, "bbox": [0, 0, 1, 1]}),
        intrusion(detail={"x_norm": 0.5, "confidence": 0.9, "bbox": [0, 0, 1]}),
        intrusion(detail={"x_norm": 0.5, "confidence": float("nan"), "bbox": [0, 0, 1, 1]}),
        intrusion(detail={"x_norm": 0.5, "confidence": 0.9, "bbox": [0, 0, 1, 1], "label": "person"}),
        predictive(detail={"anomaly_score": 0.9}),
        predictive(detail={"anomaly_score": 0.9, "drivers": "temp"}),
        predictive(kind="gas"),
    ],
)
def test_refuses_what_the_api_refuses(alert):
    assert alert_errors(alert) != []


def test_iso_utc_is_accepted_whatever_the_zone():
    paris = timezone(timedelta(hours=2))
    ts = iso_utc(datetime(2026, 10, 5, 16, 23, 5, 123456, tzinfo=paris))
    assert ts == "2026-10-05T14:23:05.123Z"
    assert alert_errors(intrusion(ts=ts)) == []
    assert alert_errors(intrusion(ts=iso_utc())) == []
