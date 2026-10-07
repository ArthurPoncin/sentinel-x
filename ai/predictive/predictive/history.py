"""The nominal telemetry of a time range, read from the api's history: what the model trains on.

The api keeps every telemetry and Alert frame it sends live in an SQLite file (backend/src/history.ts),
the one the time-scrubber replays. It is only ever opened read-only (`mode=ro`), on the `api-data`
volume mounted `:ro`: the "read-only DB user" of docs/ARCHITECTURE.md. A JSONL capture (one telemetry
payload, Alert or history frame per line) does as well, for a capture made away from the Pi.

Nominal means: the telemetry of each Sentinel, minus the periods one of its own Alerts was active.
"""

import bisect
import json
import math
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from sentinel_common.contract import iso_utc

from .features import FEATURES, MIN_SAMPLES, WINDOW_SECONDS, Sample, sample_of, windows_of
from .model import MIN_VECTORS

# The Sentinel's own Alerts: while one is active the room is not at rest (smoke, a heater, someone
# in it), and the model must not learn that as nominal.
SENTINEL_KINDS = ("gas", "thermal", "presence", "noise")
# backend/src/mock-feed.ts: the mock writes into the history like a real Sentinel, and only its
# Alerts tell it apart.
MOCK_PREFIX = "mock-"


class HistoryError(Exception):
    """The history cannot be trained on. The message says what to do."""


def moment_of(text: object) -> datetime | None:
    """The moment of an ISO 8601 time, or None. One without a zone is refused: the range is meant
    in UTC, and a local time taken for UTC would train on the wrong hours."""
    if not isinstance(text, str):
        return None
    try:
        moment = datetime.fromisoformat(text)
        return moment.astimezone(timezone.utc) if moment.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


@dataclass(frozen=True)
class Record:
    """A frame of the history: `type` telemetry or alert, at `t` seconds since the epoch."""

    t: float
    type: str
    payload: dict


@dataclass
class History:
    """The telemetry of [start, end] (both included, like GET /api/v1/history) and every Alert up
    to `end`, oldest first: an Alert raised before the range may still be active in it."""

    origin: str
    start: datetime
    end: datetime
    records: list[Record]
    # Lines or rows that are no frame at all, skipped.
    unreadable: int = 0


def _record(t: float, frame: object) -> Record | None:
    if not isinstance(frame, dict) or not isinstance(frame.get("payload"), dict):
        return None
    if frame.get("type") not in ("telemetry", "alert"):
        return None
    return Record(t, frame["type"], frame["payload"])


def read_sqlite(path: str | Path, start: datetime, end: datetime) -> History:
    """The range from the api's SQLite history, opened read-only: nothing is ever written to it,
    and it reads while the api writes (WAL)."""
    path = Path(path)
    if not path.is_file():
        raise HistoryError(
            f"no history at {path}: mount the api's data volume there (read-only), or pass --history <file>"
        )
    # Both ends included, in the api's milliseconds (`at`, the record's ts).
    first, last = math.ceil(start.timestamp() * 1000), math.floor(end.timestamp() * 1000)
    try:
        db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error as error:
        raise HistoryError(f"cannot open {path} read-only: {error}") from None
    try:
        rows = db.execute(
            "SELECT at, record FROM history"
            " WHERE (type = 'telemetry' AND at BETWEEN ? AND ?) OR (type = 'alert' AND at <= ?)"
            " ORDER BY at, id",
            (first, last, last),
        ).fetchall()
    except sqlite3.OperationalError as error:
        if "no such table" in str(error):
            raise HistoryError(f"{path} is not the api's history (no history table)") from None
        cannot_make_shm = "unable to open" in str(error) or "readonly database" in str(error)
        if cannot_make_shm and not path.with_name(f"{path.name}-shm").exists():
            # The api keeps the file in WAL mode: a reader needs the -shm file beside it, which only
            # a writer creates. On a read-only volume, that is the api, while it runs. SQLite says
            # "unable to open database file" or, of a directory its user may not write to, "attempt
            # to write a readonly database".
            raise HistoryError(
                f"cannot read {path} read-only: in WAL mode SQLite needs {path.name}-shm beside it, which"
                " only the api creates. Start the api and train again while it runs, or copy the file"
                " somewhere writable and pass --history <copy>"
            ) from None
        raise HistoryError(f"cannot read {path}: {error}") from None
    except sqlite3.DatabaseError as error:
        raise HistoryError(f"cannot read {path}: {error}") from None
    finally:
        db.close()
    records, unreadable = [], 0
    for at, text in rows:
        try:
            record = _record(at / 1000, json.loads(text))
        except ValueError:
            record = None
        if record is None:
            unreadable += 1
        else:
            records.append(record)
    return History(str(path), start, end, records, unreadable)


def _frame_of(line: object) -> object:
    """A history frame as it is, or the frame of a bare telemetry payload or Alert (what a
    `mosquitto_sub` on the Sentinel's topics prints)."""
    if isinstance(line, dict) and "type" not in line:
        if "readings" in line:
            return {"type": "telemetry", "payload": line}
        if "alert_id" in line:
            return {"type": "alert", "payload": line}
    return line


def read_jsonl(path: str | Path, start: datetime, end: datetime) -> History:
    """The range from a JSONL capture. A line that is no frame (a capture cut mid-line) is skipped
    and counted."""
    path = Path(path)
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise HistoryError(f"cannot read {path}: {error}") from None
    first, last = start.timestamp(), end.timestamp()
    records, unreadable = [], 0
    for line in lines:
        if not line.strip():
            continue
        try:
            frame = _frame_of(json.loads(line))
        except ValueError:
            frame = None
        record = _record(0, frame)
        moment = moment_of(record.payload.get("ts")) if record else None
        if moment is None:
            unreadable += 1
            continue
        record = Record(moment.timestamp(), record.type, record.payload)
        if (record.type == "telemetry" and first <= record.t <= last) or (record.type == "alert" and record.t <= last):
            records.append(record)
    # The api's order (stable on equal ts); a capture is in arrival order.
    records.sort(key=lambda r: r.t)
    return History(str(path), start, end, records, unreadable)


@dataclass
class Period:
    """When Alerts of a Sentinel were active, from the first raised to the last cleared (inclusive);
    `end` is infinite when one was still active at the end of the range."""

    start: float
    end: float
    kinds: set[str]


@dataclass
class SentinelData:
    """One Sentinel's share of the range."""

    sentinel: str
    snapshots: int = 0
    # Snapshots that are no valid telemetry (sample_of refuses them).
    invalid: int = 0
    # Valid snapshots dropped because an Alert of the Sentinel was active.
    excluded: int = 0
    periods: list[Period] = field(default_factory=list)
    # The kept Samples, cut wherever an excluded period lies between two of them.
    runs: list[list[Sample]] = field(default_factory=list)
    # The Sample that closed each window, and the vectors: what the model trains on.
    closing: list[Sample] = field(default_factory=list)
    vectors: np.ndarray = field(default_factory=lambda: np.empty((0, len(FEATURES))))

    @property
    def kept(self) -> int:
        return sum(map(len, self.runs))


@dataclass
class Nominal:
    history: History
    sentinels: list[SentinelData]

    @property
    def vectors(self) -> np.ndarray:
        return np.concatenate([s.vectors for s in self.sentinels]).reshape(-1, len(FEATURES))


def _span(history: History) -> str:
    return f"{iso_utc(history.start)} and {iso_utc(history.end)}"


def _refuse_mock(history: History) -> None:
    """A range the mock fed, even partly, is no nominal of the real room. Its Alerts come every
    few seconds while it runs: one raised in the range, or still active at its start, betrays it."""
    first = history.start.timestamp()
    active: dict[str, Record] = {}
    for record in (r for r in history.records if r.type == "alert"):
        alert_id = record.payload.get("alert_id")
        if not (isinstance(alert_id, str) and alert_id.startswith(MOCK_PREFIX)):
            continue
        if record.t >= first:
            ts = record.payload.get("ts")
            raise HistoryError(
                f"the range holds data of the api's mock feed (Alert {alert_id} at {ts}): the mock is"
                " recorded like a real Sentinel. Pick a range when the api ran with MOCK_FEED off, or"
                " capture again with MOCK_FEED off"
            )
        if record.payload.get("state") == "cleared":
            active.pop(alert_id, None)
        else:
            active[alert_id] = record
    if active:
        alert_id = next(iter(active))
        raise HistoryError(
            f"the api's mock feed was running at the start of the range (Alert {alert_id} still active):"
            " pick a range when the api ran with MOCK_FEED off, or capture again with MOCK_FEED off"
        )


def _alert_periods(history: History) -> dict[str, list[Period]]:
    """The periods each Sentinel had one of its own Alerts active, merged, oldest first. A raised
    and its cleared pair by alert_id, as the api's Status does; one never cleared lasts to the end."""
    active: dict[tuple[str, str], tuple[float, str]] = {}
    periods: dict[str, list[Period]] = defaultdict(list)
    for record in (r for r in history.records if r.type == "alert"):
        alert = record.payload
        if alert.get("kind") not in SENTINEL_KINDS:
            continue
        key = (alert.get("sentinel"), alert.get("alert_id"))
        if alert.get("state") == "raised":
            active.setdefault(key, (record.t, alert["kind"]))
        elif alert.get("state") == "cleared" and key in active:
            since, kind = active.pop(key)
            periods[key[0]].append(Period(since, record.t, {kind}))
    for (sentinel, _), (since, kind) in active.items():
        periods[sentinel].append(Period(since, math.inf, {kind}))
    first = history.start.timestamp()
    merged: dict[str, list[Period]] = {}
    for sentinel, spans in periods.items():
        kept: list[Period] = []
        # Over before the range: they exclude nothing in it.
        for span in sorted((s for s in spans if s.end >= first), key=lambda s: s.start):
            if kept and span.start <= kept[-1].end:
                kept[-1].end = max(kept[-1].end, span.end)
                kept[-1].kinds |= span.kinds
            else:
                kept.append(span)
        merged[sentinel] = kept
    return merged


def nominal(history: History) -> Nominal:
    """The nominal of the range, Sentinel by Sentinel, through the same window as the live service.
    Refuses (HistoryError) a range the mock fed, an empty one, or one with too little nominal."""
    _refuse_mock(history)
    periods = _alert_periods(history)
    starts = {name: [p.start for p in spans] for name, spans in periods.items()}
    by_sentinel: dict[str, SentinelData] = {}
    runs: dict[str, dict[int, list[Sample]]] = defaultdict(lambda: defaultdict(list))
    for record in (r for r in history.records if r.type == "telemetry"):
        name = record.payload.get("sentinel")
        name = name if isinstance(name, str) and name else "?"
        data = by_sentinel.setdefault(name, SentinelData(name, periods=periods.get(name, [])))
        data.snapshots += 1
        sample = sample_of(record.payload)
        if sample is None:
            data.invalid += 1
            continue
        # The run a Sample belongs to is the number of periods begun before it: two Samples with a
        # period between them never share a window, so the gap makes no slope.
        run = bisect.bisect_right(starts.get(name, []), sample.t)
        if run and sample.t <= data.periods[run - 1].end:
            data.excluded += 1
        else:
            runs[name][run].append(sample)
    for name, data in by_sentinel.items():
        data.runs = [runs[name][run] for run in sorted(runs[name])]
        for samples in data.runs:
            closing, vectors = windows_of(samples, WINDOW_SECONDS, MIN_SAMPLES)
            data.closing += closing
            data.vectors = np.concatenate([data.vectors, vectors])
    if not by_sentinel:
        raise HistoryError(
            f"no telemetry between {_span(history)} in {history.origin}: give the range in UTC (with its Z),"
            " and check the api recorded the Sentinel then (the dashboard's time-scrubber shows it)"
        )
    found = Nominal(history, sorted(by_sentinel.values(), key=lambda s: s.sentinel))
    vectors = len(found.vectors)
    if vectors < MIN_VECTORS:
        excluded, invalid = (sum(getattr(s, n) for s in found.sentinels) for n in ("excluded", "invalid"))
        why = f", {excluded} snapshots dropped while an Alert of the Sentinel was active" if excluded else ""
        why += f", {invalid} snapshots that are no valid telemetry" if invalid else ""
        raise HistoryError(
            f"too little nominal between {_span(history)}: {vectors} vectors, at least {MIN_VECTORS} needed"
            f"{why}. Capture longer at rest (2–4 h, no Sentinel Alert), then train on that range"
        )
    return found
