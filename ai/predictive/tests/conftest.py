import pytest

from predictive import simulate, synthetic
from predictive.features import sample_of, windows_of


@pytest.fixture(scope="session")
def model():
    """The model of the simulator: 2 h of synthetic nominal (seed 0). Trained once, a few seconds."""
    return simulate.nominal_model(seed=0)


@pytest.fixture(scope="session")
def nominal_vectors():
    """Vectors of 1 h of synthetic nominal the model never saw (seed 100)."""
    _, vectors = windows_of([sample_of(p) for p in synthetic.nominal(3600, seed=100)])
    return vectors
