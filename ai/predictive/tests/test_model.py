import joblib
import numpy as np
import pytest

from predictive import model as model_module
from predictive.features import FEATURES
from predictive.model import Model, train


def test_the_levels_are_learned_and_ordered(model):
    assert 0 < model.clear_level < model.raise_level < 1
    assert model.trained_on > 7000
    assert model.data_from == "2026-10-06T08:00:00Z" and model.data_to == "2026-10-06T09:59:59Z"


def test_scores_are_the_isolation_forest_anomaly_score(model, nominal_vectors):
    scores = model.score(nominal_vectors)
    assert ((0 < scores) & (scores < 1)).all()
    # ~0.5 for the usual (Liu et al.).
    assert np.median(scores) == pytest.approx(0.5, abs=0.1)


def test_a_verdict_is_the_same_scored_alone_or_in_a_batch(model, nominal_vectors):
    batch = model.judge(nominal_vectors[:50])
    assert [model.judge(v)[0] for v in nominal_vectors[:50]] == batch


def test_the_drivers_name_the_features_furthest_from_nominal(model, nominal_vectors):
    vector = np.median(nominal_vectors, axis=0)
    temp, temp_mean, air = (FEATURES.index(f) for f in ("temp", "temp_mean", "air"))
    vector[temp] += 20 * model.spread[temp]
    vector[temp_mean] += 10 * model.spread[temp_mean]
    vector[air] += 5 * model.spread[air]
    vector[FEATURES.index("humidity")] += 4 * model.spread[FEATURES.index("humidity")]
    # At most 3, furthest first.
    assert model.judge(vector)[0].drivers == ["temp", "temp_mean", "air"]


def test_with_no_feature_far_out_the_furthest_one_is_named(model, nominal_vectors):
    vector = np.median(nominal_vectors, axis=0)
    i = FEATURES.index("air_slope")
    vector[i] += 2 * model.spread[i]
    assert model.judge(vector)[0].drivers == ["air_slope"]


def test_a_save_and_load_round_trip_scores_the_same(model, nominal_vectors, tmp_path):
    path = tmp_path / "models" / "predictive.joblib"
    model.save(path)
    loaded = Model.load(path)
    assert np.array_equal(loaded.score(nominal_vectors), model.score(nominal_vectors))
    assert (loaded.raise_level, loaded.clear_level) == (model.raise_level, model.clear_level)
    assert (loaded.window_seconds, loaded.min_samples, loaded.trained_on) == (120, 20, model.trained_on)


@pytest.mark.parametrize(
    "saved",
    [
        lambda m: {"version": model_module.VERSION + 1, "sklearn": model_module.sklearn.__version__, "model": m},
        lambda m: {"version": model_module.VERSION, "sklearn": "0.1", "model": m},
        lambda m: m,  # a bare model, without its version
        lambda m: {"version": model_module.VERSION, "sklearn": model_module.sklearn.__version__, "model": "a forest"},
    ],
)
def test_a_model_file_of_another_version_is_refused(model, tmp_path, saved):
    path = tmp_path / "predictive.joblib"
    joblib.dump(saved(model), path)
    with pytest.raises(ValueError, match="train it again"):
        Model.load(path)


def test_too_little_nominal_data_is_refused(nominal_vectors):
    with pytest.raises(ValueError, match="too little"):
        train(nominal_vectors[:99])
    assert train(nominal_vectors[:100]).trained_on == 100


def test_unusable_training_data_is_refused(nominal_vectors):
    poisoned = nominal_vectors[:200].copy()
    poisoned[10, 0] = np.nan
    with pytest.raises(ValueError):
        train(poisoned)
    with pytest.raises(ValueError):
        train(nominal_vectors, raise_quantile=0.9, clear_quantile=0.99)
