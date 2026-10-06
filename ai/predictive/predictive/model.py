"""The Isolation Forest, trained on nominal vectors only, and what it says about a new one.

Nothing here is a hand-set threshold: the levels at which an Alert is raised and cleared are
quantiles of the scores the nominal capture gets, and no Reading is ever compared to a number.
"""

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from sentinel_common.contract import iso_utc

from .features import FEATURES, MIN_SAMPLES, WINDOW_SECONDS, SlidingWindow

# Bumped whenever what a model file holds changes meaning: an older file is refused, not misread.
VERSION = 1

MIN_VECTORS = 100
TREES = 200
SEED = 0
RAISE_QUANTILE = 0.999
CLEAR_QUANTILE = 0.99
# The levels are quantiles of held-out scores: each nominal vector scored by a forest that never
# saw the ~10 min block it belongs to (see _held_out_scores).
FOLDS = 5
FOLD_VECTORS = 600

# Above this robust z-score, a feature is far enough from its nominal spread to be named a driver.
DRIVER_Z = 3.0
MAX_DRIVERS = 3


@dataclass(frozen=True)
class Verdict:
    # 0–1, the Isolation Forest's own anomaly score (Liu et al.): ~0.5 for the usual, → 1 for the odd.
    anomaly_score: float
    # The features furthest from their nominal spread, furthest first.
    drivers: list[str]


@dataclass
class Model:
    scaler: StandardScaler
    forest: IsolationForest
    # Robust centre and spread of each feature on the nominal data: what names the drivers.
    median: np.ndarray
    spread: np.ndarray
    # Learned levels: raise at or above `raise_level`, clear once back under `clear_level`.
    raise_level: float
    clear_level: float
    # The window the vectors were made with: the live service must score through the same one.
    window_seconds: float
    min_samples: int
    # Where it comes from, for the logs and whoever wonders which capture it learned.
    trained_on: int
    trained_at: str
    data_from: str | None = None
    data_to: str | None = None
    features: tuple[str, ...] = field(default=FEATURES)

    def window(self) -> SlidingWindow:
        """A fresh window for one Sentinel, shaped as the training one."""
        return SlidingWindow(self.window_seconds, self.min_samples)

    def score(self, vectors: np.ndarray) -> np.ndarray:
        """The anomaly score of each vector. score_samples is the opposite of the paper's score."""
        return -self.forest.score_samples(self.scaler.transform(np.atleast_2d(vectors)))

    def judge(self, vectors: np.ndarray) -> list[Verdict]:
        """The Verdict on each vector. Scoring many in one call is what makes a replay fast (a
        call costs ~10 ms however few vectors it holds); each Verdict is the same either way."""
        vectors = np.atleast_2d(vectors)
        if len(vectors) == 0:
            return []
        z = np.abs((vectors - self.median) / self.spread)
        verdicts = []
        for score, row in zip(self.score(vectors), z):
            far = [i for i in np.argsort(-row, kind="stable") if row[i] >= DRIVER_Z][:MAX_DRIVERS]
            # An anomaly with no single feature out of its range is a combination of them: name
            # the one that moved most anyway.
            drivers = [self.features[i] for i in (far or [int(np.argmax(row))])]
            verdicts.append(Verdict(float(score), drivers))
        return verdicts

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"version": VERSION, "sklearn": sklearn.__version__, "model": self}, path)

    @staticmethod
    def load(path: str | Path) -> "Model":
        """The model saved at `path`. Only ever load a file the service wrote itself: joblib
        unpickles, which runs whatever the file says."""
        saved = joblib.load(path)
        # A forest pickled by another scikit-learn may load and score differently: train again.
        if (
            not isinstance(saved, dict)
            or saved.get("version") != VERSION
            or saved.get("sklearn") != sklearn.__version__
            or not isinstance(saved.get("model"), Model)
            or saved["model"].features != FEATURES
        ):
            raise ValueError(f"{path} is not a model of this version of the service: train it again")
        return saved["model"]


def robust_spread(vectors: np.ndarray) -> np.ndarray:
    """The interquartile range of each feature, scaled to match a standard deviation on normal
    data. A feature that never moved (IQR 0) falls back to its standard deviation, then to 1, so
    the tiniest wiggle does not make it a driver of infinite z."""
    q1, q3 = np.percentile(vectors, [25, 75], axis=0)
    spread = (q3 - q1) / 1.349
    spread = np.where(spread > 0, spread, vectors.std(axis=0))
    return np.where(spread > 0, spread, 1.0)


def _held_out_scores(scaled: np.ndarray, folds: int, seed: int) -> np.ndarray:
    """The score of each nominal vector by a forest that did not learn it.

    A forest's score of the very vectors it learned is too kind for quantile levels: a window
    shares nearly all its snapshots with the windows around it, so every training vector has
    near-twins in the training set, where an unseen nominal hour has none. On the synthetic
    nominal, levels taken from those scores raise a false Alert about once a day. So the capture
    is cut into blocks of ~10 min dealt round-robin into `folds` folds, and each fold is scored by
    a forest fitted on the others: the scores a nominal hour the model never saw would get."""
    block = min(FOLD_VECTORS, -(-len(scaled) // folds))
    fold = (np.arange(len(scaled)) // block) % folds
    scores = np.empty(len(scaled))
    for f in range(folds):
        forest = IsolationForest(n_estimators=TREES, random_state=seed).fit(scaled[fold != f])
        scores[fold == f] = -forest.score_samples(scaled[fold == f])
    return scores


def train(
    vectors: np.ndarray,
    *,
    window_seconds: float = WINDOW_SECONDS,
    min_samples: int = MIN_SAMPLES,
    data_from: str | None = None,
    data_to: str | None = None,
    raise_quantile: float = RAISE_QUANTILE,
    clear_quantile: float = CLEAR_QUANTILE,
    folds: int = FOLDS,
    seed: int = SEED,
) -> Model:
    """Fits the forest on nominal vectors (from `windows_of`, in time order) and learns its raise
    and clear levels from them. `window_seconds` and `min_samples` must be those the vectors were
    made with. `folds` < 2 takes the levels from the final forest's own scores instead."""
    vectors = np.asarray(vectors, dtype=float).reshape(-1, len(FEATURES))
    if len(vectors) < MIN_VECTORS:
        raise ValueError(f"{len(vectors)} vectors is too little nominal data: capture longer (2–4 h)")
    if not np.isfinite(vectors).all():
        raise ValueError("the vectors hold a NaN or an infinity")
    if not 0 < clear_quantile < raise_quantile < 1:
        raise ValueError("the quantiles must satisfy 0 < clear < raise < 1")
    scaler = StandardScaler().fit(vectors)
    scaled = scaler.transform(vectors)
    forest = IsolationForest(n_estimators=TREES, random_state=seed).fit(scaled)
    model = Model(
        scaler=scaler,
        forest=forest,
        median=np.median(vectors, axis=0),
        spread=robust_spread(vectors),
        raise_level=0.0,
        clear_level=0.0,
        window_seconds=window_seconds,
        min_samples=min_samples,
        trained_on=len(vectors),
        trained_at=iso_utc(),
        data_from=data_from,
        data_to=data_to,
    )
    scores = _held_out_scores(scaled, folds, seed) if folds >= 2 else model.score(vectors)
    model.raise_level = float(np.quantile(scores, raise_quantile))
    model.clear_level = float(np.quantile(scores, clear_quantile))
    return model
