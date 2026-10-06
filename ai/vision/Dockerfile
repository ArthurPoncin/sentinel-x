# The vision service. Built on the Pi (arm64) or anywhere else: Debian's own OpenCV and NumPy, nothing
# from pip but the TFLite runtime — the Pi OS (Bookworm, Python 3.11) ships the same builds, and Picamera2
# only comes as an apt package that goes with them. The context is ai/, so the image takes ai/common along:
#   docker build -f ai/vision/Dockerfile -t sentinel-x/vision ai/
#   docker run --env-file ai/vision/.env --read-only --cap-drop ALL --security-opt no-new-privileges \
#     --device /dev/video0 --group-add video sentinel-x/vision
# The ZIF camera needs more device nodes than a webcam: docker-compose.camera.yml lists them.
FROM debian:bookworm-slim

# Nothing written at runtime: no .pyc next to the code (the root file system is read-only), logs
# straight to Docker.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/common:/app/vision

# Debian's OpenCV and NumPy and, on arm64 (the Pi), Picamera2 and the libcamera it drives, from the
# Raspberry Pi archive: the Pi OS's own pairing, for CAMERA_SOURCE=picamera2 (the ZIF camera). Elsewhere
# there is no ZIF camera to read: neither the archive nor Picamera2. The archive's key is checked against
# its sha256 before apt trusts it.
ARG RPI_ARCHIVE_KEY_SHA256=76603890d82a492175caf17aba68dc73acb1189c9fd58ec0c19145dfa3866d56
RUN set -eu; \
    camera=; \
    if [ "$(dpkg --print-architecture)" = arm64 ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends ca-certificates curl; \
      curl -fsSL https://archive.raspberrypi.com/debian/raspberrypi.gpg.key -o /usr/share/keyrings/raspberrypi.asc; \
      echo "$RPI_ARCHIVE_KEY_SHA256  /usr/share/keyrings/raspberrypi.asc" | sha256sum -c -; \
      chmod 644 /usr/share/keyrings/raspberrypi.asc; \
      echo "deb [signed-by=/usr/share/keyrings/raspberrypi.asc] https://archive.raspberrypi.com/debian bookworm main" \
        > /etc/apt/sources.list.d/raspberrypi.list; \
      apt-get purge -y --auto-remove curl; \
      camera=python3-picamera2; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 python3-numpy python3-opencv $camera; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY common/sentinel_common common/sentinel_common
COPY vision/vision vision/vision

# --- #74, the TFLite person detector: its runtime, then the model, fetched at build time. ----------
# The runtime is the one package apt does not have: pip puts it next to Debian's NumPy, pinned to the
# version apt installed — left free, pip takes ml_dtypes 0.6 and NumPy 2 with it, and python3-opencv,
# built against NumPy 1, no longer imports. Then pip goes away. The model lives
# in the image (the root file system is read-only at runtime), out of git, its sha256 checked.
COPY vision/requirements.txt vision/fetch_model.py /tmp/vision/
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3-pip \
    && pip3 install --no-cache-dir --break-system-packages --disable-pip-version-check \
       "$(grep '^ai-edge-litert==' /tmp/vision/requirements.txt)" \
       "numpy==$(python3 -c 'import numpy; print(numpy.__version__)')" \
    && python3 /tmp/vision/fetch_model.py /models/efficientdet_lite0.tflite \
    && apt-get purge -y --auto-remove python3-pip \
    && rm -rf /var/lib/apt/lists/* /tmp/vision
ENV TFLITE_MODEL=/models/efficientdet_lite0.tflite

# A fixed unprivileged user. Compose adds the host's `video` group (group_add) for the camera nodes.
RUN groupadd --gid 10002 vision \
    && useradd --uid 10002 --gid 10002 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin vision
USER 10002:10002

# The feed (/) and /health, on the internal network only: never published.
EXPOSE 8000
# Unhealthy while the camera is down: /health answers 503 then.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python3", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('HTTP_PORT') or 8000}/health\", timeout=2)"]

# python3 itself is PID 1: it gets the SIGTERM of `docker compose stop`, clears the intrusion in
# progress and shuts down cleanly.
ENTRYPOINT ["python3", "-m", "vision"]
