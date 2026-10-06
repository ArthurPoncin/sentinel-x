"""python3 fetch_model.py <path>: downloads the person detector's model (EfficientDet-Lite0, 320x320 uint8,
with its post-processing and COCO label map built in) to <path>, and checks it is the very file pinned here.

Run when the image is built (`RUN python3 fetch_model.py /models/efficientdet_lite0.tflite`), or once on a
laptop; the weights are never committed (`*.tflite` is gitignored). Standard library only: it runs before
anything is installed. Exits non-zero, leaving nothing at <path>, when the download fails or its sha256 is
not the pinned one; does nothing when <path> already holds the right file.

The model is TensorFlow's EfficientDet-Lite0 (Apache 2.0), as TensorFlow's own Raspberry Pi example
downloads it. Not MediaPipe's efficientdet_lite0.tflite, which upstream's README links: that one leaves the
anchor decoding and non-maximum suppression to MediaPipe (19206 raw boxes out) and upstream's code cannot
read it.
"""

import hashlib
import os
import sys
import tempfile
import urllib.request

MODEL_URL = (
    "https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/object_detection/rpi/"
    "lite-model_efficientdet_lite0_detection_metadata_1.tflite"
)
MODEL_SHA256 = "2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b"
# The model is 4.6 MB: a server sending far more is not sending it, and must not fill the disk.
MAX_BYTES = 64 * 1024 * 1024


class FetchError(Exception):
    pass


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(path: str, url: str = MODEL_URL, sha256: str = MODEL_SHA256, timeout: float = 60.0) -> bool:
    """Puts the file at `url` at `path` once its sha256 is checked: True when it was downloaded, False when
    `path` already held it. Written to a temporary file next to `path`, then renamed: `path` is either the
    whole checked file or untouched. A FetchError otherwise."""
    if os.path.isfile(path) and sha256_of(path) == sha256:
        return False
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    handle, partial = tempfile.mkstemp(prefix=".fetch-", dir=directory)
    try:
        digest, size = hashlib.sha256(), 0
        with os.fdopen(handle, "wb") as file, urllib.request.urlopen(url, timeout=timeout) as response:
            for chunk in iter(lambda: response.read(1 << 16), b""):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise FetchError(f"{url}: more than {MAX_BYTES} bytes, not the model")
                digest.update(chunk)
                file.write(chunk)
        if digest.hexdigest() != sha256:
            raise FetchError(f"{url}: sha256 {digest.hexdigest()}, expected {sha256}")
        # mkstemp makes it 0600: the service may run as another user than the one who fetched it.
        os.chmod(partial, 0o644)
        os.replace(partial, path)
    except OSError as error:
        raise FetchError(f"{url}: {error}") from None
    finally:
        if os.path.exists(partial):
            os.remove(partial)
    return True


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or args[0].startswith("-"):
        sys.exit("usage: python3 fetch_model.py <path of the .tflite file to write>")
    try:
        downloaded = fetch(args[0])
    except FetchError as error:
        sys.exit(f"Model not fetched: {error}")
    print(f"{args[0]}: {'downloaded and' if downloaded else 'already there,'} sha256 checked")


if __name__ == "__main__":
    main()
