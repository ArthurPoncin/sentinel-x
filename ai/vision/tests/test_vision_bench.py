import time

import cv2
import numpy as np
import pytest

from vision import bench
from vision.detectors import MotionDetector, MotionGate
from vision.sources import Frame, OpenCVSource

from .test_detectors import Scene


def write_walk(path, frames=60, fps=100.0):
    """A 640x480 video of the test scene's "person" walking across, fast: the benchmark waits on its pace."""
    scene = Scene(seed=5)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (640, 480))
    assert writer.isOpened()
    for i in range(frames):
        writer.write(scene.frame(40 + 8 * i if i >= 30 else None))
    writer.release()
    return path


@pytest.fixture
def video(tmp_path):
    return write_walk(tmp_path / "walk.avi")


def measure(video, detector, frames=30, **options):
    source = OpenCVSource(str(video))
    source.open()
    try:
        return bench.run(source, detector, frames, warmup=5, source_name="opencv:walk.avi", **options)
    finally:
        source.close()


def test_the_benchmark_measures_capture_and_inference_on_a_video(video):
    report = measure(video, MotionDetector())
    assert report.frames == 30 and len(report.inference_ms) == 30 and report.model_runs == 30
    assert report.size == (640, 480)
    assert all(ms > 0 for ms in report.capture_ms) and all(ms > 0 for ms in report.inference_ms)
    assert bench.percentile(report.inference_ms, 0.5) <= bench.percentile(report.inference_ms, 0.95)
    # The file plays at 100 fps: the loop keeps up with it, or close.
    assert 20 < report.processed_fps <= report.camera_fps * 1.1 and report.camera_fps < 130
    lines = report.table().splitlines()
    assert lines[0] == bench.HEADER.splitlines()[0] and len(lines) == 3
    cells = [cell.strip() for cell in lines[2].strip("|").split("|")]
    assert len(cells) == lines[0].count("|") - 1
    assert cells[1:4] == ["opencv:walk.avi 640x480", "motion", "30"]
    assert cells[6] == "30 / 30"


def test_infer_every_and_the_motion_gate_show_in_the_numbers(video):
    report = measure(video, MotionDetector(), infer_every=3)
    assert report.frames == 30 and len(report.inference_ms) == 10
    assert report.detector == "motion, every 3 frames"

    class Never:
        name = "person"
        threads = 2

        def detect(self, image):
            return []

    # Behind the gate, the model runs at first, then only when something moves.
    gate = MotionGate(Never(), MotionDetector(warmup=5), hold=0.05)
    report = measure(video, gate)
    assert report.detector == "person, 2 threads, motion gate"
    assert 0 < report.model_runs < len(report.inference_ms) == 30


def test_percentile_interpolates_as_numpy_does():
    values = list(np.random.default_rng(0).normal(50, 10, 101)) + [3.0]
    for q in (0, 0.5, 0.95, 1):
        assert bench.percentile(values, q) == pytest.approx(np.percentile(values, q * 100))
    assert bench.percentile([7.0], 0.95) == 7.0


class Stuck:
    """A camera that gave one frame and nothing since."""

    ok = False

    def read(self):
        return Frame(np.zeros((48, 64, 3), np.uint8), 1, time.monotonic())


def test_a_camera_that_gives_nothing_fails_the_benchmark():
    with pytest.raises(RuntimeError, match="no frame from the camera"):
        bench.run(Stuck(), MotionDetector(), 5, warmup=0, timeout=0.1)


def test_the_command_prints_a_table_ready_for_the_readme(video, monkeypatch, capsys):
    for name in ("DETECTOR", "INFER_EVERY", "MOTION_GATE", "MOTION_GATE_HOLD_S"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CAMERA_SOURCE", f"opencv:{video}")
    bench.main(["--frames", "20", "--warmup", "3", "--machine", "laptop"])
    out = capsys.readouterr().out.splitlines()
    assert out[0].startswith("| Machine |")
    # The video by its name: this machine's directories stay out of the README.
    assert out[2].startswith("| laptop | opencv:walk.avi 640x480 | motion | 20 |")


def test_the_command_names_a_bad_setting(monkeypatch):
    monkeypatch.setenv("CAMERA_SOURCE", "opencv:0")
    monkeypatch.setenv("DETECTOR", "yolo")
    with pytest.raises(SystemExit, match="Invalid configuration: DETECTOR"):
        bench.main([])
