# The vision service. Built on the Pi (arm64) or anywhere else: Debian's own OpenCV and NumPy, nothing
# from pip — the Pi OS (Bookworm, Python 3.11) ships the same builds, and Picamera2 (#46) only comes as
# an apt package that goes with them. The context is ai/, so the image takes ai/common along:
#   docker build -f ai/vision/Dockerfile -t sentinel-x/vision ai/
#   docker run --env-file ai/vision/.env --read-only --cap-drop ALL --security-opt no-new-privileges \
#     --device /dev/video0 --group-add video sentinel-x/vision
FROM debian:bookworm-slim

# Nothing written at runtime: no .pyc next to the code (the root file system is read-only), logs
# straight to Docker.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/common:/app/vision

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-numpy python3-opencv \
    && rm -rf /var/lib/apt/lists/*

# --- #46, the ZIF camera (Picamera2): the Raspberry Pi apt repository, then its package. -----------
# RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
#     && curl -fsSL https://archive.raspberrypi.com/debian/raspberrypi.gpg.key \
#        | gpg --dearmor -o /usr/share/keyrings/raspberrypi.gpg \
#     && echo "deb [signed-by=/usr/share/keyrings/raspberrypi.gpg] http://archive.raspberrypi.com/debian bookworm main" \
#        > /etc/apt/sources.list.d/raspi.list \
#     && apt-get update && apt-get install -y --no-install-recommends python3-picamera2 \
#     && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY common/sentinel_common common/sentinel_common
COPY vision/vision vision/vision

# --- #74, the TFLite person detector: its runtime, then the model, fetched at build time. ----------
# The model lives in the image (the root file system is read-only at runtime), out of git.
# RUN <install the TFLite runtime> \
#     && python3 vision/fetch_model.py /models/<model file>

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
