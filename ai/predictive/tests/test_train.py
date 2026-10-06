"""#71: `python -m predictive train`, from the api's history to a model file."""

import json
import re
from datetime import timedelta

import pytest

from predictive import synthetic
from predictive.__main__ import main
from predictive.model import Model

T = synthetic.START


def at(minutes, seconds=0):
    return (T + timedelta(minutes=minutes, seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture
def records(alert):
    """10 min of nominal, with a gas Alert from 08:03 to 08:04."""
    payloads = synthetic.nominal(600, seed=0)
    return (
        payloads[:181]
        + [alert("g1", "gas", "raised", at(3))]
        + payloads[181:241]
        + [alert("g1", "gas", "cleared", at(4))]
        + payloads[241:]
    )


def train(start, end, *options):
    main(["train", "--from", start, "--to", end, *options])


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in ("HISTORY_FILE", "MODEL_FILE"):
        monkeypatch.delenv(name, raising=False)


def test_it_trains_in_one_command_on_a_range_of_the_history(tmp_path, history_db, records, capsys):
    model_file = tmp_path / "model" / "model.joblib"
    train(at(0), at(10), "--history", str(history_db(records)), "--model", str(model_file))
    out = capsys.readouterr().out
    model = Model.load(model_file)
    assert (model.data_from, model.data_to) == ("2026-10-06T08:00:00.000Z", "2026-10-06T08:10:00.000Z")
    assert "sentinel-01: 600 snapshots, 539 kept, 61 excluded (Alert active), 0 invalid" in out
    assert "excluded from 2026-10-06T08:03:00.000Z to 2026-10-06T08:04:00.000Z: gas Alert active" in out
    assert f"→ {model.trained_on} vectors" in out
    assert (
        f"Trained on {model.trained_on} vectors: raise at {model.raise_level:.3f}, clear under {model.clear_level:.3f}"
        in out
    )
    share = r"On its own training windows: \d+\.\d\d% score at or above the raise level, a replay raises \d+"
    assert re.search(share + " predictive Alert", out)
    assert f"Saved to {model_file}" in out
    assert [f.name for f in model_file.parent.iterdir()] == ["model.joblib"]


def test_the_files_default_to_the_environment(tmp_path, history_db, records, monkeypatch, capsys):
    monkeypatch.setenv("HISTORY_FILE", str(history_db(records)))
    monkeypatch.setenv("MODEL_FILE", str(tmp_path / "from-env.joblib"))
    train(at(0), at(10))
    assert Model.load(tmp_path / "from-env.joblib").trained_on > 100
    assert "Read " + str(tmp_path / "history" / "history.sqlite") in capsys.readouterr().out


def test_it_trains_on_a_jsonl_capture(tmp_path, records, capsys):
    jsonl = tmp_path / "capture.jsonl"
    jsonl.write_text("".join(json.dumps(r) + "\n" for r in records))
    train(at(0), at(10), "--jsonl", str(jsonl), "--model", str(tmp_path / "m.joblib"))
    assert "539 kept, 61 excluded" in capsys.readouterr().out
    assert Model.load(tmp_path / "m.joblib").trained_on > 100


def test_a_refused_range_saves_nothing_and_says_what_to_do(tmp_path, history_db, records):
    model_file = tmp_path / "model.joblib"
    with pytest.raises(SystemExit) as refused:
        train(at(60), at(70), "--history", str(history_db(records)), "--model", str(model_file))
    assert str(refused.value.code).startswith("Training refused: no telemetry between")
    assert not model_file.exists()
    with pytest.raises(SystemExit, match="--from must come before --to"):
        train(at(10), at(0), "--history", str(history_db(records)), "--model", str(model_file))


def test_a_range_needs_its_zone(capsys):
    with pytest.raises(SystemExit):
        train("2026-10-06T08:00:00", at(10))
    assert "expected an ISO 8601 time with its zone" in capsys.readouterr().err
