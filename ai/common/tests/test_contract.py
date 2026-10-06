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
