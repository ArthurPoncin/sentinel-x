"""`python -m predictive train --from <ISO> --to <ISO>`: the model, learned in one command from a
range of the api's history (or a JSONL capture), saved where the live service loads it.

What it prints is the check before trusting the model: how much of the range was kept, the levels
it learned, and how often it would have raised on the very capture it learned from.
"""

import argparse
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import sklearn

from sentinel_common.config import env_str
from sentinel_common.contract import iso_utc

from . import history
from .detector import replay
from .history import HistoryError, Nominal
from .model import VERSION, Model, train

# The paths Docker Compose mounts: the api's data volume read-only, the model's volume.
HISTORY_FILE = "/history/history.sqlite"
MODEL_FILE = "/model/model.joblib"


@dataclass(frozen=True)
class Trained:
    model: Model
    nominal: Nominal
    # On the training windows themselves: the share scoring at or above the raise level, and the
    # predictive Alerts a replay of the capture would raise.
    share_above: float
    raised: int


def train_on(nominal: Nominal) -> Trained:
    """The model of a range's nominal, and how it judges that very range."""
    found = nominal.history
    model = train(nominal.vectors, data_from=iso_utc(found.start), data_to=iso_utc(found.end))
    share_above = float(np.mean(model.score(nominal.vectors) >= model.raise_level))
    raised = sum(
        alert["state"] == "raised"
        for data in nominal.sentinels
        for run in data.runs
        for alert in replay(model, run, data.sentinel)
    )
    return Trained(model, nominal, share_above, raised)


def _moment(epoch: float) -> str:
    return iso_utc(datetime.fromtimestamp(epoch, timezone.utc))


def summary(trained: Trained, model_file: str) -> str:
    """What `train` prints."""
    model, found = trained.model, trained.nominal.history
    lines = [f"Read {found.origin} from {iso_utc(found.start)} to {iso_utc(found.end)}."]
    if found.unreadable:
        lines.append(f"Skipped {found.unreadable} unreadable records (not a telemetry or Alert frame).")
    first = found.start.timestamp()
    for data in trained.nominal.sentinels:
        lines.append(
            f"{data.sentinel}: {data.snapshots} snapshots, {data.kept} kept, {data.excluded} excluded"
            f" (Alert active), {data.invalid} invalid → {len(data.vectors)} vectors"
        )
        for period in data.periods:
            since = _moment(period.start) + (" (before the range)" if period.start < first else "")
            until = "the end of the range" if math.isinf(period.end) else _moment(period.end)
            lines.append(f"  excluded from {since} to {until}: {', '.join(sorted(period.kinds))} Alert active")
    lines += [
        f"Trained on {model.trained_on} vectors: raise at {model.raise_level:.3f}, clear under"
        f" {model.clear_level:.3f} (learned quantiles of held-out nominal scores).",
        f"On its own training windows: {trained.share_above:.2%} score at or above the raise level,"
        f" a replay raises {trained.raised} predictive Alert{'s' if trained.raised != 1 else ''}.",
        f"Saved to {model_file} (model format {VERSION}, scikit-learn {sklearn.__version__}).",
    ]
    return "\n".join(lines)


def _range_end(text: str) -> datetime:
    moment = history.moment_of(text)
    if moment is None:
        raise argparse.ArgumentTypeError(
            f"expected an ISO 8601 time with its zone, such as 2026-10-06T08:00:00Z, got {text!r}"
        )
    return moment


def add_parser(commands) -> None:
    """The `train` subcommand, on the subparsers of `python -m predictive`."""
    parser = commands.add_parser("train", help="train the model on a range of the api's history, read-only")
    for flag, dest in (("--from", "start"), ("--to", "end")):
        parser.add_argument(
            flag, dest=dest, type=_range_end, required=True, help=f"{dest} of the range, ISO 8601, included"
        )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--history", help=f"the api's SQLite history (default: HISTORY_FILE, or {HISTORY_FILE})")
    source.add_argument(
        "--jsonl", help="a JSONL capture instead: one telemetry payload, Alert or history frame per line"
    )
    parser.add_argument("--model", help=f"where to save the model (default: MODEL_FILE, or {MODEL_FILE})")


def command(args: argparse.Namespace) -> None:
    """Runs `train`; a refusal exits with what to do."""
    model_file = args.model or env_str("MODEL_FILE", MODEL_FILE)
    try:
        if args.start >= args.end:
            raise HistoryError("--from must come before --to")
        if args.jsonl:
            found = history.read_jsonl(args.jsonl, args.start, args.end)
        else:
            found = history.read_sqlite(args.history or env_str("HISTORY_FILE", HISTORY_FILE), args.start, args.end)
        trained = train_on(history.nominal(found))
    except HistoryError as error:
        raise SystemExit(f"Training refused: {error}") from None
    # The live service reloads the file when it changes: it must never find half of one.
    partial = Path(f"{model_file}.partial")
    try:
        trained.model.save(partial)
        os.replace(partial, model_file)
    except OSError as error:
        raise SystemExit(f"Cannot save the model to {model_file}: {error}") from None
    print(summary(trained, model_file))
