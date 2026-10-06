# The predictive service. Built on the Pi (arm64) or anywhere else: wheels only, nothing to compile.
# The context is ai/, so the image takes ai/common along:
#   docker build -f ai/predictive/Dockerfile -t sentinel-x/predictive ai/
#   docker run --env-file ai/predictive/.env -v predictive-model:/model -v "$PWD/infra/secrets/ca.crt:/certs/ca.crt:ro" \
#     --read-only --cap-drop ALL --security-opt no-new-privileges sentinel-x/predictive
FROM python:3.13-slim-bookworm

# Nothing written at runtime but the model, on its volume: no .pyc next to the code (the root file
# system is read-only), logs straight to Docker.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/common:/app/predictive

WORKDIR /app
COPY predictive/requirements.txt predictive/requirements.txt
RUN PIP_ROOT_USER_ACTION=ignore pip install --no-cache-dir --disable-pip-version-check -r predictive/requirements.txt
COPY common/sentinel_common common/sentinel_common
COPY predictive/predictive predictive/predictive

# A fixed unprivileged user. The model volume is created owned by it, so `train` can write the model
# the service reads.
RUN groupadd --gid 10001 predictive \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin predictive \
    && mkdir /model && chown predictive:predictive /model
VOLUME /model
USER 10001:10001

# python itself is PID 1: it gets the SIGTERM of `docker compose stop` and shuts down cleanly.
ENTRYPOINT ["python", "-m", "predictive"]
CMD ["run"]
