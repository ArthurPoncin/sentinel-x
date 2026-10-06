import json
import os
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

import pytest

from predictive import simulate, synthetic
from predictive.features import sample_of, windows_of

AI = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def model():
    """The model of the simulator: 2 h of synthetic nominal (seed 0). Trained once, a few seconds."""
    return simulate.nominal_model(seed=0)


@pytest.fixture(scope="session")
def nominal_vectors():
    """Vectors of 1 h of synthetic nominal the model never saw (seed 100)."""
    _, vectors = windows_of([sample_of(p) for p in synthetic.nominal(3600, seed=100)])
    return vectors


# backend/src/history.ts, word for word: the file the api writes and `train` reads.
HISTORY_SCHEMA = """
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      sentinel TEXT NOT NULL,
      record TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS history_by_time ON history (at, id);
    CREATE INDEX IF NOT EXISTS history_by_type ON history (type, at, id);
"""


def frame(payload):
    """The history frame of a telemetry payload or an Alert."""
    return {"type": "alert" if "alert_id" in payload else "telemetry", "payload": payload}


@pytest.fixture
def alert():
    """An Alert as the api records it, from the Sentinel (`source` esp32) unless said otherwise."""

    def make(alert_id, kind, state, ts, sentinel=synthetic.SENTINEL, source="esp32"):
        return {
            "alert_id": alert_id,
            "sentinel": sentinel,
            "source": source,
            "kind": kind,
            "severity": "warning",
            "state": state,
            "ts": ts,
        }

    return make


@pytest.fixture
def history_db(tmp_path):
    """Writes telemetry payloads and Alerts, in the order given, into an SQLite history made as the
    api makes it; returns the file. With `keep_open`, the writer stays connected, as the running
    api does (its -wal and -shm files stay beside the database), until the test ends."""
    writers = []

    def write(payloads, keep_open=False, directory="history"):
        path = tmp_path / directory / "history.sqlite"
        path.parent.mkdir(exist_ok=True)
        db = sqlite3.connect(path)
        db.executescript(HISTORY_SCHEMA)
        for payload in payloads:
            at = round(datetime.fromisoformat(payload["ts"]).timestamp() * 1000)
            row = frame(payload)
            db.execute(
                "INSERT INTO history (at, type, sentinel, record) VALUES (?, ?, ?, ?)",
                (at, row["type"], payload["sentinel"], json.dumps(row)),
            )
        db.commit()
        if keep_open:
            writers.append(db)
        else:
            db.close()
        return path

    yield write
    for db in writers:
        db.close()


@pytest.fixture
def read_only():
    """Runs a command with a directory truly read-only, as the api-data volume mounted `:ro`: through
    the file modes for a user, through a read-only bind mount for root, whom modes do not stop.
    Skips where neither is possible."""
    restore = []

    def run(directory, argv):
        if os.geteuid() != 0:
            for path in [directory, *directory.iterdir()]:
                restore.append((path, path.stat().st_mode))
                path.chmod(0o555 if path.is_dir() else 0o444)
            prefix = []
        else:
            remount = 'mount --bind "$0" "$0" && mount -o remount,bind,ro "$0" "$0" && exec "$@"'
            prefix = ["unshare", "--mount", "sh", "-c", remount, str(directory)]
        try:
            probe = subprocess.run([*prefix, "sh", "-c", f'! touch "{directory}/probe"'], capture_output=True)
        except OSError:
            probe = None
        if probe is None or probe.returncode != 0:
            pytest.skip("cannot make a directory read-only here")
        env = {**os.environ, "PYTHONPATH": os.pathsep.join(str(AI / d) for d in ("common", "predictive"))}
        return subprocess.run([*prefix, *argv], capture_output=True, text=True, env=env, timeout=120)

    yield run
    for path, mode in reversed(restore):
        if path.exists():
            path.chmod(mode)
