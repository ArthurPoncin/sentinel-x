"""#71: the nominal of a range of the api's history, read-only."""

import json
import math
import sqlite3
import sys
from datetime import datetime, timedelta

import pytest

from predictive import synthetic
from predictive.features import sample_of, windows_of
from predictive.history import HistoryError, moment_of, nominal, read_jsonl, read_sqlite

T = synthetic.START


def at(minutes, seconds=0):
    """The ts of a second of the synthetic capture, which starts at 08:00:00Z."""
    return (T + timedelta(minutes=minutes, seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def moment(minutes, seconds=0):
    return T + timedelta(minutes=minutes, seconds=seconds)


def epoch(ts):
    return datetime.fromisoformat(ts).timestamp()


def capture(seconds=600, seed=0, sentinel=synthetic.SENTINEL):
    payloads = synthetic.nominal(seconds, seed)
    return [{**p, "sentinel": sentinel} for p in payloads]


def with_alerts(payloads, *alerts):
    """The capture with Alerts recorded right after the snapshot they share a ts with (or first)."""
    records = list(payloads)
    for alert in alerts:
        index = next((i + 1 for i, p in enumerate(records) if p["ts"] == alert["ts"]), 0)
        records.insert(index, alert)
    return records


def vectors_of(payloads):
    return len(windows_of([sample_of(p) for p in payloads])[1])


def test_a_history_made_by_the_api_gives_the_nominal_of_the_range(history_db):
    path = history_db(capture(900))
    found = nominal(read_sqlite(path, moment(1), moment(10)))
    [data] = found.sentinels
    # Both ends included, as GET /api/v1/history.
    in_range = capture(900)[60:601]
    assert (data.sentinel, data.snapshots, data.kept, data.excluded, data.invalid) == ("sentinel-01", 541, 541, 0, 0)
    assert len(found.vectors) == len(data.vectors) == vectors_of(in_range)
    assert data.closing[0].ts == at(2) and data.closing[-1].ts == at(10)


def test_the_periods_a_sentinel_alert_was_active_are_left_out(history_db, alert):
    path = history_db(with_alerts(capture(), alert("a1", "gas", "raised", at(3)), alert("a1", "gas", "cleared", at(4))))
    [data] = nominal(read_sqlite(path, moment(0), moment(10))).sentinels
    assert (data.snapshots, data.excluded, data.kept) == (600, 61, 539)
    [period] = data.periods
    assert (period.start, period.end, period.kinds) == (epoch(at(3)), epoch(at(4)), {"gas"})
    # No window straddles the gap: the first after it waits for a minute of new snapshots, so the
    # level before and after an incident never makes a slope.
    assert [len(run) for run in data.runs] == [180, 359]
    assert not [s for s in data.closing if epoch(at(3)) <= s.t < epoch(at(5, 1))]
    assert len(data.vectors) == vectors_of(capture()[:180]) + vectors_of(capture()[241:])


def test_an_alert_still_active_at_the_end_excludes_until_the_end(history_db, alert):
    path = history_db(with_alerts(capture(), alert("t1", "thermal", "raised", at(8))))
    [data] = nominal(read_sqlite(path, moment(0), moment(10))).sentinels
    assert data.excluded == 120 and data.periods[0].end == math.inf
    assert max(s.t for run in data.runs for s in run) < epoch(at(8))


def test_an_alert_raised_before_the_range_excludes_until_its_clear(history_db, alert):
    records = with_alerts(
        capture(), alert("p1", "presence", "raised", at(0, 30)), alert("p1", "presence", "cleared", at(2))
    )
    [data] = nominal(read_sqlite(history_db(records), moment(1), moment(10))).sentinels
    # From the start of the range, 08:01:00, to the clear, 08:02:00.
    assert (data.snapshots, data.excluded) == (540, 61)
    assert data.periods[0].start == epoch(at(0, 30))


def test_overlapping_alerts_merge_and_one_cleared_long_ago_excludes_nothing(history_db, alert):
    records = with_alerts(
        capture(),
        alert("old", "gas", "raised", at(0, 10)),
        alert("old", "gas", "cleared", at(0, 20)),
        alert("n1", "noise", "raised", at(3)),
        alert("g1", "gas", "raised", at(3, 30)),
        alert("n1", "noise", "cleared", at(4)),
        alert("g1", "gas", "cleared", at(5)),
    )
    [data] = nominal(read_sqlite(history_db(records), moment(1), moment(10))).sentinels
    [period] = data.periods
    assert (period.start, period.end, period.kinds) == (epoch(at(3)), epoch(at(5)), {"gas", "noise"})
    assert data.excluded == 121


def test_only_the_sentinels_own_alerts_exclude(history_db, alert):
    records = with_alerts(
        capture(),
        alert("i1", "intrusion", "raised", at(3), source="vision"),
        alert("d1", "predictive", "raised", at(4), source="predictive"),
        alert("g2", "gas", "raised", at(5), sentinel="sentinel-02"),
    )
    [data] = nominal(read_sqlite(history_db(records), moment(0), moment(10))).sentinels
    assert data.excluded == 0 and data.periods == []


def test_each_sentinel_has_its_own_windows(history_db):
    # Interleaved in the history; mixed in one window, every other snapshot would be "from the past".
    one, two = capture(), capture(seed=1, sentinel="sentinel-02")
    found = nominal(read_sqlite(history_db([p for pair in zip(one, two, strict=True) for p in pair]), moment(0), moment(10)))
    assert [s.sentinel for s in found.sentinels] == ["sentinel-01", "sentinel-02"]
    assert [len(s.vectors) for s in found.sentinels] == [vectors_of(one), vectors_of(two)]
    assert len(found.vectors) == vectors_of(one) + vectors_of(two)


def test_a_range_the_mock_fed_is_refused(history_db, alert):
    mock = [alert("mock-k2-1-noise", "noise", state, at(5, s)) for state, s in (("raised", 0), ("cleared", 2))]
    path = history_db(with_alerts(capture(), *mock))
    with pytest.raises(HistoryError, match="mock feed .*MOCK_FEED off"):
        nominal(read_sqlite(path, moment(0), moment(10)))
    # Over before the range, the mock does not matter.
    assert nominal(read_sqlite(path, moment(5, 3), moment(10))).sentinels


def test_a_range_the_mock_was_feeding_at_its_start_is_refused(history_db, alert):
    path = history_db(with_alerts(capture(), alert("mock-k2-1-gas", "gas", "raised", at(1))))
    with pytest.raises(HistoryError, match="mock feed was running"):
        nominal(read_sqlite(path, moment(2), moment(10)))


def test_an_empty_range_is_refused(history_db):
    path = history_db(capture())
    with pytest.raises(HistoryError, match="no telemetry between 2026-10-06T12:00:00.000Z .*UTC"):
        nominal(read_sqlite(path, moment(240), moment(300)))


def test_too_little_nominal_is_refused(history_db, alert):
    path = history_db(capture(150))
    with pytest.raises(HistoryError, match="too little nominal .*: 90 vectors, at least 100 .*Capture longer"):
        nominal(read_sqlite(path, moment(0), moment(10)))
    path = history_db(with_alerts(capture(), alert("g1", "gas", "raised", at(0))), directory="busy")
    with pytest.raises(HistoryError, match="0 vectors.*600 snapshots dropped while an Alert"):
        nominal(read_sqlite(path, moment(0), moment(10)))


def test_a_jsonl_capture_reads_like_the_history(tmp_path, history_db, alert):
    records = with_alerts(capture(), alert("a1", "gas", "raised", at(3)), alert("a1", "gas", "cleared", at(4)))
    # Bare payloads (a mosquitto_sub) and history frames alike, a blank line, a line cut short.
    lines = [
        json.dumps(r if i % 2 else {"type": "alert" if "alert_id" in r else "telemetry", "payload": r})
        for i, r in enumerate(records)
    ]
    jsonl = tmp_path / "capture.jsonl"
    jsonl.write_text("\n".join(lines[:100] + [""] + lines[100:] + ['{"sentinel": "sentinel-01", "ts"']) + "\n")
    from_jsonl = read_jsonl(jsonl, moment(1), moment(10))
    from_sqlite = read_sqlite(history_db(records), moment(1), moment(10))
    assert from_jsonl.unreadable == 1
    assert from_jsonl.records == from_sqlite.records
    assert (nominal(from_jsonl).vectors == nominal(from_sqlite).vectors).all()


def test_a_time_without_its_zone_is_refused():
    assert moment_of("2026-10-06T08:00:00Z") == T
    assert moment_of("2026-10-06T10:00:00+02:00") == T
    assert moment_of("2026-10-06T08:00:00") is None
    assert moment_of("yesterday") is None


def test_a_missing_file_or_another_database_is_refused(tmp_path):
    with pytest.raises(HistoryError, match="no history at .*mount the api's data volume"):
        read_sqlite(tmp_path / "missing.sqlite", moment(0), moment(10))
    other = tmp_path / "other.sqlite"
    sqlite3.connect(other).execute("CREATE TABLE t (x)").connection.close()
    with pytest.raises(HistoryError, match="not the api's history"):
        read_sqlite(other, moment(0), moment(10))
    junk = tmp_path / "junk.sqlite"
    junk.write_bytes(b"not a database" * 100)
    with pytest.raises(HistoryError, match="cannot read"):
        read_sqlite(junk, moment(0), moment(10))


def test_it_reads_while_the_api_writes_on_a_read_only_volume(tmp_path, history_db, read_only):
    path = history_db(capture(), keep_open=True)
    model = tmp_path / "model" / "model.joblib"
    result = read_only(
        path.parent,
        [
            sys.executable,
            "-m",
            "predictive",
            "train",
            "--from",
            at(0),
            "--to",
            at(10),
            "--history",
            str(path),
            "--model",
            str(model),
        ],
    )
    assert result.returncode == 0, result.stderr
    assert "sentinel-01: 600 snapshots, 600 kept" in result.stdout
    assert model.is_file()


def test_a_read_only_volume_without_the_api_running_says_what_to_do(tmp_path, history_db, read_only):
    # The api closed it: SQLite removed the -shm file, and a read-only reader cannot create it.
    path = history_db(capture())
    result = read_only(
        path.parent,
        [
            sys.executable,
            "-m",
            "predictive",
            "train",
            "--from",
            at(0),
            "--to",
            at(10),
            "--history",
            str(path),
            "--model",
            str(tmp_path / "m"),
        ],
    )
    assert result.returncode == 1
    assert "Training refused: cannot read" in result.stderr
    assert "history.sqlite-shm" in result.stderr and "Start the api" in result.stderr


def test_a_snapshot_that_is_no_valid_telemetry_is_counted_and_skipped(history_db):
    payloads = capture()
    broken = {**payloads[300], "readings": {**payloads[300]["readings"], "temp": None}}
    [data] = nominal(
        read_sqlite(history_db(payloads[:300] + [broken] + payloads[301:]), moment(0), moment(10))
    ).sentinels
    assert (data.snapshots, data.invalid, data.kept) == (600, 1, 599)
