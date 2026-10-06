# The detection part (the interpreter, the input, the outputs read back into boxes) is adapted from
# src/object-detection-tflite/object_detection_tflite.py of https://github.com/automaticdai/rpi-object-detection:
#
# The MIT License
#
# Copyright (c) 2010-2020 YunFei Robotics Lab. https://www.yfrl.org
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
"""`DETECTOR=tflite`: the people EfficientDet-Lite0 sees, on TensorFlow Lite's CPU interpreter.

The model is the one `fetch_model.py` downloads (its URL and sha256 are pinned there), at `TFLITE_MODEL`.
The interpreter comes from `ai-edge-litert` (TensorFlow Lite's own package, wheels for Python 3.11 and 3.13,
x86_64 and aarch64), imported only when this detector is made: `DETECTOR=motion` never needs it.
"""

import os
from typing import Protocol

import cv2
import numpy as np

from sentinel_common.config import ConfigError, env_int, env_str

from .tracker import Detection

DEFAULT_MODEL = "/models/efficientdet_lite0.tflite"
# COCO's `person`, the first label of the EfficientDet-Lite and SSD MobileNet TFLite models (their class
# output counts from 0).
PERSON = 0


class Interpreter(Protocol):
    """What the detector uses of a TFLite interpreter: the tests pass a fake one."""

    def allocate_tensors(self) -> None: ...
    def get_input_details(self) -> list[dict]: ...
    def get_output_details(self) -> list[dict]: ...
    def set_tensor(self, index: int, value: np.ndarray) -> None: ...
    def invoke(self) -> None: ...
    def get_tensor(self, index: int) -> np.ndarray: ...


def load_interpreter(path: str, threads: int) -> Interpreter:
    """The TFLite interpreter of the model at `path`, on `threads` CPU threads. A ConfigError when the file
    or the runtime is missing."""
    if not os.path.isfile(path):
        raise ConfigError(
            f"TFLITE_MODEL: no model at {path}. Fetch it with `python3 vision/fetch_model.py {path}` "
            "(from ai/), or point TFLITE_MODEL at where it is"
        )
    try:
        from ai_edge_litert.interpreter import Interpreter as LiteRT
    except ImportError:
        try:
            # The older name of the same runtime, as upstream tries it: an image that has it works too.
            from tflite_runtime.interpreter import Interpreter as LiteRT
        except ImportError:
            raise ConfigError(
                "DETECTOR=tflite needs the TensorFlow Lite runtime: pip install -r vision/requirements.txt "
                "(ai-edge-litert)"
            ) from None
    try:
        interpreter = LiteRT(model_path=path, num_threads=threads)
    except ValueError as error:
        raise ConfigError(f"TFLITE_MODEL: {path} is not a TFLite model ({error})") from None
    return interpreter


class TFLiteDetector:
    """The people in a frame, as a TFLite SSD-style detector with its post-processing built in sees them
    (EfficientDet-Lite0 here: up to 25 boxes, already through non-maximum suppression).

    - the frame is stretched to the model's input (320x320, uint8 RGB), not letterboxed: what the model was
      run with in upstream and in TensorFlow's own Pi example. The boxes come back normalised to that input,
      hence to the frame as a whole: × its width and height gives its pixels, the proportions undone with no
      offset to remove;
    - only `person` is kept, at `min_score` and above (the service's `MIN_CONFIDENCE`, 0.5 by default, as
      upstream); `confidence` is the model's score;
    - boxes reaching past the frame (the model allows it) are clipped to it.
    """

    name = "tflite"

    def __init__(self, interpreter: Interpreter, *, min_score: float = 0.5, threads: int | None = None) -> None:
        self._interpreter = interpreter
        self._min_score = min_score
        self.threads = threads
        interpreter.allocate_tensors()
        (tensor,) = interpreter.get_input_details()
        shape = tuple(tensor["shape"])
        if len(shape) != 4 or shape[0] != 1 or shape[3] != 3 or tensor["dtype"] not in (np.uint8, np.float32):
            raise ConfigError(f"TFLITE_MODEL: expected a 1xHxWx3 uint8 or float32 input, got {shape} {tensor['dtype']}")
        self._input, self._dtype = tensor["index"], tensor["dtype"]
        self._size = (int(shape[2]), int(shape[1]))  # width, height: what cv2.resize takes
        # TFLite_Detection_PostProcess gives boxes [1, N, 4], classes [1, N], scores [1, N] and the count [1],
        # in that order of tensors, but output_details does not list them in any promised order (upstream
        # takes them by position, which a model converted otherwise breaks): the shapes tell boxes and count
        # apart, the tensors' order classes from scores.
        outputs = sorted(interpreter.get_output_details(), key=lambda d: d["index"])
        boxes = [d["index"] for d in outputs if len(d["shape"]) == 3 and d["shape"][2] == 4]
        rows = [d["index"] for d in outputs if len(d["shape"]) == 2]
        counts = [d["index"] for d in outputs if len(d["shape"]) == 1]
        if len(outputs) != 4 or len(boxes) != 1 or len(rows) != 2 or len(counts) != 1:
            shapes = [tuple(d["shape"]) for d in outputs]
            raise ConfigError(
                f"TFLITE_MODEL: expected a detection model with its post-processing (boxes, classes, scores, "
                f"count), got outputs {shapes}"
            )
        self._boxes, (self._classes, self._scores), self._count = boxes[0], rows, counts[0]

    @classmethod
    def from_env(cls, min_score: float) -> "TFLiteDetector":
        """`TFLITE_MODEL` (/models/efficientdet_lite0.tflite), `TFLITE_THREADS` (4: the Pi 4's cores)."""
        threads = env_int("TFLITE_THREADS", 4, min=1, max=16)
        # expanduser: `~` in a .env file reaches us as is.
        interpreter = load_interpreter(os.path.expanduser(env_str("TFLITE_MODEL", DEFAULT_MODEL)), threads)
        return cls(interpreter, min_score=min_score, threads=threads)

    def detect(self, image: np.ndarray) -> list[Detection]:
        height, width = image.shape[:2]
        # Resized first, converted after: the colour conversion then works on 320x320, not 640x480.
        pixels = cv2.cvtColor(cv2.resize(image, self._size), cv2.COLOR_BGR2RGB)[np.newaxis]
        if self._dtype == np.float32:
            pixels = (pixels.astype(np.float32) - 127.5) / 127.5
        interpreter = self._interpreter
        interpreter.set_tensor(self._input, pixels)
        interpreter.invoke()
        boxes = interpreter.get_tensor(self._boxes)[0]
        classes = interpreter.get_tensor(self._classes)[0]
        scores = interpreter.get_tensor(self._scores)[0]
        count = min(int(interpreter.get_tensor(self._count)[0]), len(scores))
        detections = []
        for i in range(count):
            score = float(scores[i])
            if round(float(classes[i])) != PERSON or score < self._min_score:
                continue
            # [ymin, xmin, ymax, xmax], 0→1 of the model's input, so of the frame.
            top, left, bottom, right = np.clip(boxes[i], 0.0, 1.0)
            if right <= left or bottom <= top:
                continue
            x, y = float(left) * width, float(top) * height
            w, h = float(right - left) * width, float(bottom - top) * height
            detections.append(Detection(x, y, w, h, round(score, 3)))
        detections.sort(key=lambda d: d.confidence, reverse=True)
        return detections
