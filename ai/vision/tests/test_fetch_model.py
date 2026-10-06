import hashlib
import os
import re

import pytest

import fetch_model
from fetch_model import FetchError, fetch

CONTENT = b"weights " * 1000
SHA256 = hashlib.sha256(CONTENT).hexdigest()


@pytest.fixture
def served(tmp_path):
    """A file:// URL serving CONTENT: urllib reads it as it would the model's https:// one."""
    source = tmp_path / "served" / "model.tflite"
    source.parent.mkdir()
    source.write_bytes(CONTENT)
    return source.as_uri()


def test_the_pinned_model_is_an_https_url_and_a_sha256():
    assert fetch_model.MODEL_URL.startswith("https://") and fetch_model.MODEL_URL.endswith(".tflite")
    assert re.fullmatch(r"[0-9a-f]{64}", fetch_model.MODEL_SHA256)


def test_the_file_is_written_once_checked_and_not_fetched_again(tmp_path, served):
    path = tmp_path / "models" / "model.tflite"
    assert fetch(str(path), served, SHA256) is True
    assert path.read_bytes() == CONTENT
    # Readable by the service's user, whoever fetched it.
    assert path.stat().st_mode & 0o777 == 0o644
    # Already there: nothing downloaded, not even from a URL that would fail.
    assert fetch(str(path), "file:///nowhere/model.tflite", SHA256) is False
    assert os.listdir(path.parent) == ["model.tflite"]


def test_a_sha256_mismatch_fails_and_leaves_no_file(tmp_path, served):
    path = tmp_path / "models" / "model.tflite"
    with pytest.raises(FetchError, match=f"sha256 {SHA256}, expected 0+"):
        fetch(str(path), served, "0" * 64)
    assert os.listdir(path.parent) == []


def test_a_wrong_file_in_place_is_replaced_and_untouched_when_the_download_fails(tmp_path, served):
    path = tmp_path / "model.tflite"
    path.write_bytes(b"truncated")
    with pytest.raises(FetchError):
        fetch(str(path), served, "0" * 64)
    assert path.read_bytes() == b"truncated"
    assert fetch(str(path), served, SHA256) is True
    assert path.read_bytes() == CONTENT


def test_a_failed_download_fails_and_leaves_no_file(tmp_path):
    with pytest.raises(FetchError, match="nowhere"):
        fetch(str(tmp_path / "model.tflite"), (tmp_path / "nowhere").as_uri(), SHA256)
    assert os.listdir(tmp_path) == []


def test_a_download_far_larger_than_the_model_is_cut_short(tmp_path, served, monkeypatch):
    monkeypatch.setattr(fetch_model, "MAX_BYTES", 1000)
    with pytest.raises(FetchError, match="more than 1000 bytes"):
        fetch(str(tmp_path / "model.tflite"), served, SHA256)
    assert sorted(os.listdir(tmp_path)) == ["served"]


def test_the_command_exits_non_zero_on_failure(monkeypatch, capsys):
    def failing(path):
        raise FetchError("sha256 mismatch")

    monkeypatch.setattr(fetch_model, "fetch", failing)
    with pytest.raises(SystemExit, match="Model not fetched: sha256 mismatch"):
        fetch_model.main(["/models/efficientdet_lite0.tflite"])
    with pytest.raises(SystemExit, match="usage"):
        fetch_model.main([])
    monkeypatch.setattr(fetch_model, "fetch", lambda path: True)
    fetch_model.main(["/models/efficientdet_lite0.tflite"])
    assert "downloaded and sha256 checked" in capsys.readouterr().out
