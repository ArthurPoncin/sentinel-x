"""The Alert contract (docs/ARCHITECTURE.md), mirrored from backend/src/contract.ts.

The api validates every Alert it receives and answers 400 to the slightest deviation: the services
check theirs against this mirror in their tests, so a refusal is caught before it reaches the Pi.
"""

import math
import re
from datetime import datetime, timezone

KINDS = ("gas", "thermal", "presence", "noise", "intrusion", "predictive")
SEVERITIES = ("info", "warning", "critical")
STATES = ("raised", "cleared")
SOURCES = ("esp32", "vision", "predictive")

# zod's z.iso.datetime(): UTC with a `Z`, no offset. Seconds required here, a stricter subset.
_ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

_FIELDS = {"alert_id", "sentinel", "source", "kind", "severity", "state", "value", "detail", "ts"}
# `source` is set by the api from the channel: a service may leave it out.
_REQUIRED = _FIELDS - {"source", "value"}


def iso_utc(moment: datetime | None = None) -> str:
    """A timestamp the api accepts: ISO 8601, UTC, milliseconds, `Z`. Now when no moment is given."""
    moment = (moment or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _is_number(value: object) -> bool:
    # bool is an int in Python, and JSON has no NaN: zod refuses both.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_name(value: object) -> bool:
    return isinstance(value, str) and len(value) > 0


def _is_share(value: object) -> bool:
    return _is_number(value) and 0 <= value <= 1


def _is_id(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


# The people the camera sees at once: the one it follows, and at most this many others.
MAX_OTHERS = 4
_OTHER = {"id", "x_norm", "h_norm", "confidence"}


def _other_errors(where: str, other: object) -> list[str]:
    if not isinstance(other, dict):
        return [f"{where}: not an object"]
    errors = [f"{where}.{key}: unknown field" for key in other.keys() - _OTHER]
    errors += [f"{where}.{key}: missing" for key in sorted(_OTHER - other.keys())]
    if "id" in other and not _is_id(other["id"]):
        errors.append(f"{where}.id: not a whole number, 0 or more")
    for key in ("x_norm", "h_norm"):
        if key in other and not _is_share(other[key]):
            errors.append(f"{where}.{key}: not a number between 0 and 1")
    if "confidence" in other and not _is_number(other["confidence"]):
        errors.append(f"{where}.confidence: not a number")
    return errors


def _detail_errors(kind: str, detail: object) -> list[str]:
    if not isinstance(detail, dict):
        return ["detail: not an object"]
    if kind == "intrusion":
        expected = {"x_norm", "confidence", "bbox"}
        # What a camera that turns adds, each on its own: the api takes an Alert without them.
        optional = {"id", "h_norm", "pan", "others"}
        errors = [f"detail.{key}: unknown field" for key in detail.keys() - expected - optional]
        errors += [f"detail.{key}: missing" for key in expected - detail.keys()]
        bbox, pan, others = detail.get("bbox"), detail.get("pan"), detail.get("others")
        for key in ("x_norm", "h_norm"):
            if key in detail and not _is_share(detail[key]):
                errors.append(f"detail.{key}: not a number between 0 and 1")
        if "confidence" in detail and not _is_number(detail["confidence"]):
            errors.append("detail.confidence: not a number")
        if "bbox" in detail and not (isinstance(bbox, list) and len(bbox) == 4 and all(map(_is_number, bbox))):
            errors.append("detail.bbox: not 4 numbers")
        if "id" in detail and not _is_id(detail["id"]):
            errors.append("detail.id: not a whole number, 0 or more")
        if "pan" in detail and not (_is_number(pan) and -180 <= pan <= 180):
            errors.append("detail.pan: not a number between -180 and 180")
        if "others" in detail:
            if not (isinstance(others, list) and len(others) <= MAX_OTHERS):
                errors.append(f"detail.others: not a list of at most {MAX_OTHERS} people")
            else:
                for index, other in enumerate(others):
                    errors += _other_errors(f"detail.others[{index}]", other)
        return errors
    if kind == "predictive":
        expected = {"anomaly_score", "drivers"}
        errors = [f"detail.{key}: unknown field" for key in detail.keys() - expected]
        errors += [f"detail.{key}: missing" for key in expected - detail.keys()]
        drivers = detail.get("drivers")
        if "anomaly_score" in detail and not _is_number(detail["anomaly_score"]):
            errors.append("detail.anomaly_score: not a number")
        if "drivers" in detail and not (isinstance(drivers, list) and all(isinstance(d, str) for d in drivers)):
            errors.append("detail.drivers: not a list of strings")
        return errors
    # The Sentinel's kinds carry no detail.
    return [f"detail.{key}: unknown field" for key in detail]


def alert_errors(alert: object) -> list[str]:
    """What the api would refuse in this Alert body; empty when it would accept it."""
    if not isinstance(alert, dict):
        return ["not an object"]
    errors = [f"{key}: unknown field" for key in alert.keys() - _FIELDS]
    errors += [f"{key}: missing" for key in sorted(_REQUIRED - alert.keys())]
    for key in ("alert_id", "sentinel"):
        if key in alert and not _is_name(alert[key]):
            errors.append(f"{key}: not a non-empty string")
    for key, allowed in (("source", SOURCES), ("kind", KINDS), ("severity", SEVERITIES), ("state", STATES)):
        if key in alert and alert[key] not in allowed:
            errors.append(f"{key}: not one of {', '.join(allowed)}")
    if "value" in alert and not _is_number(alert["value"]):
        errors.append("value: not a number")
    if "ts" in alert and not (isinstance(alert["ts"], str) and _ISO_UTC.match(alert["ts"])):
        errors.append("ts: not an ISO 8601 UTC timestamp ending in Z")
    if alert.get("kind") in KINDS and "detail" in alert:
        errors += _detail_errors(alert["kind"], alert["detail"])
    return errors
