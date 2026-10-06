"""python -m vision.bench: how fast the vision service can go on this machine, with this camera and detector.

The service's own configuration (`CAMERA_SOURCE`, `DETECTOR` and its settings, `MOTION_GATE`,
`INFER_EVERY`), without token, Alerts or feed: frames in, the detector on them as the service's loop runs
it, then a Markdown table row to paste into ai/README.md.
"""

import argparse
import os
import platform
import sys
import time
from dataclasses import dataclass

from sentinel_common.config import ConfigError, env_int, env_str

from .detectors import Detector, make_detector
from .sources import FrameSource, make_source

HEADER = (
    "| Machine | Source | Detector | Frames | Capture ms p50 / p95 | Inference ms p50 / p95 | Model runs "
    "| Camera fps | Processed fps |\n"
    "|---|---|---|---|---|---|---|---|---|"
)


def percentile(values: list[float], q: float) -> float:
    """The `q` quantile (0→1) of `values`, interpolated between the two nearest ones, as NumPy's default."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


@dataclass(frozen=True)
class Report:
    machine: str
    source: str
    detector: str
    size: tuple[int, int]  # the frames' width and height
    capture_ms: list[float]  # per frame handled
    inference_ms: list[float]  # per detect() call
    model_runs: int  # the calls that ran the model: all of them, but behind the motion gate
    seconds: float
    camera_frames: int  # the frames the camera delivered meanwhile, handled or not (the rest were too late)

    @property
    def frames(self) -> int:
        return len(self.capture_ms)

    @property
    def processed_fps(self) -> float:
        return self.frames / self.seconds if self.seconds > 0 else 0.0

    @property
    def camera_fps(self) -> float:
        return self.camera_frames / self.seconds if self.seconds > 0 else 0.0

    def row(self) -> str:
        def p50_p95(values: list[float]) -> str:
            return f"{percentile(values, 0.5):.1f} / {percentile(values, 0.95):.1f}" if values else "-"

        width, height = self.size
        return (
            f"| {self.machine} | {self.source} {width}x{height} | {self.detector} | {self.frames} "
            f"| {p50_p95(self.capture_ms)} | {p50_p95(self.inference_ms)} | {self.model_runs} / {len(self.inference_ms)} "
            f"| {self.camera_fps:.1f} | {self.processed_fps:.1f} |"
        )

    def table(self) -> str:
        return f"{HEADER}\n{self.row()}"


def describe(detector: Detector, infer_every: int) -> str:
    """The detector and the levers it runs with, for the table."""
    # Behind the motion gate, the person detector it gates.
    inner = getattr(detector, "inner", detector)
    parts = [inner.name]
    if getattr(inner, "threads", None):
        parts.append(f"{inner.threads} thread{'s' if inner.threads > 1 else ''}")
    if inner is not detector:
        parts.append("motion gate")
    if infer_every > 1:
        parts.append(f"every {infer_every} frames")
    return ", ".join(parts)


def run(
    source: FrameSource,
    detector: Detector,
    frames: int,
    *,
    infer_every: int = 1,
    warmup: int = 10,
    timeout: float = 15.0,
    machine: str | None = None,
    source_name: str = "",
) -> Report:
    """Feeds `detector` the opened source's new frames as the service's loop does: `warmup` frames first,
    not counted (the first inferences are slow, the motion detector learns its scene), then `frames`.
    A RuntimeError when the camera gives no frame for `timeout` seconds."""
    last_index, handled, last_new = 0, 0, time.monotonic()
    capture_ms: list[float] = []
    inference_ms: list[float] = []
    started = first_index = runs_before = 0
    while len(capture_ms) < frames:
        frame = source.read()
        if frame is None or frame.index == last_index:
            if time.monotonic() - last_new > timeout:
                raise RuntimeError(f"no frame from the camera for {timeout:g} s")
            # Polled finely: a coarse poll would show in the frame rate.
            time.sleep(0.0005)
            continue
        last_index, last_new = frame.index, time.monotonic()
        if handled == warmup:
            # The clock starts on the first counted frame.
            started, first_index = time.perf_counter(), frame.index
            runs_before = getattr(detector, "runs", 0)
        counted = handled >= warmup
        # Counted from the first frame, as the service does.
        if handled % infer_every == 0:
            begin = time.perf_counter()
            detector.detect(frame.image)
            if counted:
                inference_ms.append((time.perf_counter() - begin) * 1000)
        if counted:
            capture_ms.append(frame.capture_ms)
        handled += 1
    seconds = time.perf_counter() - started
    height, width = frame.image.shape[:2]
    runs = getattr(detector, "runs", None)
    return Report(
        machine=machine or f"{platform.machine()}, {os.cpu_count()} CPUs",
        source=source_name,
        detector=describe(detector, infer_every),
        size=(width, height),
        capture_ms=capture_ms,
        inference_ms=inference_ms,
        model_runs=runs - runs_before if runs is not None else len(inference_ms),
        seconds=seconds,
        # From the first counted frame to the last one handled.
        camera_frames=frame.index - first_index + 1,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m vision.bench",
        description="Capture and inference times of the vision service on CAMERA_SOURCE with DETECTOR, as a "
        "Markdown table row for ai/README.md.",
    )
    parser.add_argument("--frames", type=int, default=200, help="frames measured (200)")
    parser.add_argument("--warmup", type=int, default=10, help="frames run first, not measured (10)")
    parser.add_argument("--machine", help='the Machine column, e.g. "Pi 4 4 GB" (the CPU architecture and count)')
    args = parser.parse_args(argv)
    if args.frames < 1 or args.warmup < 0:
        parser.error("--frames must be 1 or more, --warmup 0 or more")
    try:
        source_name = env_str("CAMERA_SOURCE", "opencv:0")
        detector_name = env_str("DETECTOR", "motion")
        infer_every = env_int("INFER_EVERY", 1, min=1, max=30)
        source = make_source(source_name)
        detector = make_detector(detector_name)
    except ConfigError as error:
        sys.exit(f"Invalid configuration: {error}")
    kind, _, target = source_name.partition(":")
    # A video file by its name only: the table is for the README, not for this machine's directories.
    label = f"{kind}:{os.path.basename(target)}" if os.sep in target else source_name
    print(f"{detector_name} on {source_name}: {args.warmup} + {args.frames} frames…", file=sys.stderr)
    source.open()
    try:
        report = run(
            source, detector, args.frames, infer_every=infer_every, warmup=args.warmup, machine=args.machine,
            source_name=label,
        )
    except RuntimeError as error:
        sys.exit(f"Benchmark failed: {error}")
    finally:
        source.close()
    print(report.table())


if __name__ == "__main__":
    main()
