"""`python -m predictive run`: the live service. Subscribed to every Sentinel's telemetry over MQTTS,
one window and one detector per Sentinel, each transition posted to the api as a `predictive` Alert.

It starts without a model, and says so: it scores nothing until MODEL_FILE appears, then takes up
every new version of it, so `docker compose run --rm predictive train …` is enough to (re)arm it.

The MQTT wiring (BrokerLink) is kept thin: what to do with a message (TelemetryHandler) and when to
take up a model (ModelStore) are tested without a broker.
"""

import json
import logging
import os
import re
import signal
import ssl
import threading
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from sentinel_common.alerts import AlertClient
from sentinel_common.config import ConfigError, env_float, env_required, env_secret, env_str, env_url

from .detector import Monitor
from .features import sample_of
from .model import Model

logger = logging.getLogger(__name__)

TOPIC = "sentinel/+/telemetry"
# sentinel/<id>/telemetry, the id as the api's contract has it: one topic level, no wildcard.
# ASCII \w, as in the api's JavaScript regex.
_TOPIC = re.compile(r"sentinel/([\w-]{1,64})/telemetry", re.ASCII)
# The broker refuses bigger packets (infra/mosquitto/mosquitto.conf): anything bigger is not ours.
MAX_PAYLOAD = 4096
# Only the Sentinels the ACL lets publish reach us; a cap all the same, so a bug cannot grow it forever.
MAX_SENTINELS = 64
# How often what is not worth a line per message is summed up: invalid payloads, a missing model.
REPORT_S = 300.0

MQTTS_PORT = 8883
KEEPALIVE_S = 30
# Between two attempts to reach the broker: from 1 s, doubling up to 30 s while it stays away.
RECONNECT_MIN_S = 1
RECONNECT_MAX_S = 30


@dataclass(frozen=True)
class Config:
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str
    mqtt_password: str = field(repr=False)
    ca_file: str
    # Built from ca_file at startup, so an unreadable CA stops the service with its variable's name.
    tls: ssl.SSLContext = field(repr=False, compare=False)
    alerts_url: str
    token: str = field(repr=False)
    model_file: str
    model_poll_s: float


def _mqtt_url(name: str) -> tuple[str, int]:
    url = env_required(name)
    # Not echoed until it is known to hold no credentials: they would end up in the logs.
    try:
        parts = urlsplit(url)
    except ValueError:
        raise ConfigError(f"{name}: not a URL") from None
    if parts.username is not None or parts.password is not None:
        raise ConfigError(f"{name}: put the credentials in MQTT_USERNAME and MQTT_PASSWORD, not in the URL")
    # The broker has no plaintext listener: MQTTS or nothing.
    if parts.scheme != "mqtts" or not parts.hostname:
        raise ConfigError(f"{name}: expected an mqtts:// URL, got {url!r}")
    try:
        port = parts.port
    except ValueError:
        raise ConfigError(f"{name}: invalid port, got {url!r}") from None
    return parts.hostname, port or MQTTS_PORT


def tls_context(ca_file: str) -> ssl.SSLContext:
    """Only the team CA vouches for the broker: certificate required, its name checked against the
    host of MQTT_URL (the broker's certificate carries DNS:mosquitto), TLS 1.2 at least."""
    context = ssl.create_default_context(cafile=ca_file)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


def load_config() -> Config:
    """The service's configuration, from its environment. Raises a ConfigError naming the variable."""
    host, port = _mqtt_url("MQTT_URL")
    username = env_str("MQTT_USERNAME", "predictive")
    password = env_secret("MQTT_PASSWORD", min_length=1)
    ca_file = env_required("MQTT_CA_FILE")
    if not os.path.isfile(ca_file):
        raise ConfigError(f"MQTT_CA_FILE: no file at {ca_file!r}")
    try:
        tls = tls_context(ca_file)
    except (OSError, ssl.SSLError) as error:
        raise ConfigError(f"MQTT_CA_FILE: {ca_file!r} is not a readable PEM certificate ({error})") from None
    return Config(
        mqtt_host=host,
        mqtt_port=port,
        mqtt_username=username,
        mqtt_password=password,
        ca_file=ca_file,
        tls=tls,
        alerts_url=env_url("ALERTS_URL", "http://api:8080/api/v1/alerts"),
        token=env_secret("PREDICTIVE_TOKEN"),
        model_file=env_str("MODEL_FILE", "/model/model.joblib"),
        model_poll_s=env_float("MODEL_POLL_S", 10.0, min=0.1, max=3600.0),
    )


def describe(model: Model) -> str:
    """What a log line says of a model: what it learned from, its learned levels, its window."""
    span = f"{model.data_from} → {model.data_to}" if model.data_from and model.data_to else "an unknown range"
    return (
        f"{model.trained_on} vectors of {span} (trained {model.trained_at}), "
        f"raise at {model.raise_level:.3f}, clear under {model.clear_level:.3f}, "
        f"window {model.window_seconds:g} s / {model.min_samples} snapshots"
    )


class ModelStore:
    """MODEL_FILE, polled: poll() returns the model each time a new version of the file can be
    loaded, None otherwise. A file that cannot be loaded is logged once and skipped until it changes
    again: whoever polls keeps the model it has."""

    def __init__(self, path: str, clock=time.monotonic):
        self.path = path
        self._clock = clock
        # What the file looked like when last read: a new mtime, size or inode is a new version.
        self._seen: tuple[int, int, int] | None = None
        self._loaded = False
        self._gone_logged = False
        self._reminded_at: float | None = None

    def poll(self) -> Model | None:
        try:
            stat = os.stat(self.path)
        except FileNotFoundError:
            self._missing()
            return None
        except OSError as error:
            logger.warning("Model file %s cannot be read: %s", self.path, error)
            return None
        self._gone_logged = False
        version = (stat.st_mtime_ns, stat.st_size, stat.st_ino)
        if version == self._seen:
            return None
        self._seen = version
        try:
            model = Model.load(self.path)
        except Exception as error:
            # A file half written, one of another version, not a model at all. joblib raises
            # anything from EOFError to KeyError on garbage.
            if self._loaded:
                logger.error("Model file %s cannot be loaded, keeping the current model: %s", self.path, error)
            else:
                logger.error("Model file %s cannot be loaded, still not scoring: %s", self.path, error)
            return None
        self._loaded = True
        logger.info("Model loaded from %s: %s", self.path, describe(model))
        return model

    def _missing(self) -> None:
        if self._loaded:
            if not self._gone_logged:
                self._gone_logged = True
                logger.warning("Model file %s is gone: keeping the model already loaded", self.path)
            return
        now = self._clock()
        if self._reminded_at is None or now - self._reminded_at >= REPORT_S:
            self._reminded_at = now
            logger.warning(
                "No model at %s: reading the telemetry, scoring none of it until one is trained "
                "(python -m predictive train)",
                self.path,
            )


class TelemetryHandler:
    """What the service does with each telemetry message, on whatever thread delivers it: one
    Monitor per Sentinel, the Sentinel taken from the topic (never from the payload), and the Alerts
    they emit handed to `post`. Thread-safe: the network thread delivers messages while the main
    thread swaps models."""

    def __init__(self, post, clock=time.monotonic):
        self._post = post
        self._clock = clock
        self._lock = threading.Lock()
        self._model: Model | None = None
        self._monitors: dict[str, Monitor] = {}
        # Per Sentinel, the raised Alert not cleared yet, and the ts of its last snapshot.
        self._open: dict[str, dict] = {}
        self._last_ts: dict[str, str] = {}
        self.received = 0
        # Snapshots handed to a Monitor: scored once its window holds enough of them.
        self.fed = 0
        # Every message refused since startup, by reason; the period's are summed up by report().
        self.invalid: Counter[str] = Counter()
        self._period: Counter[str] = Counter()
        self._period_from = clock()

    @property
    def model(self) -> Model | None:
        return self._model

    def use(self, model: Model) -> None:
        """Scores with `model` from now on, every Sentinel starting over with a fresh window: the
        episodes the previous model opened are cleared, as no one could clear them any more."""
        with self._lock:
            self._close_episodes("a new model takes over")
            if self._monitors:
                logger.info("%d Sentinel(s) start over with the new model", len(self._monitors))
            self._model = model
            self._monitors = {}

    def close(self) -> None:
        """Clears the open episodes: the service stops, and an Alert it raised would stay raised."""
        with self._lock:
            self._close_episodes("the service stops")

    def on_message(self, topic: str, payload: bytes) -> None:
        with self._lock:
            self.received += 1
            try:
                self._handle(topic, payload)
            except Exception:
                # Whatever one message does, the next ones are still read.
                logger.exception("Telemetry on %r: unexpected error", topic[:100])
                self._refuse("unexpected error", topic)

    def report(self) -> None:
        """Logs the period's refused messages once it is over: one line every REPORT_S at most."""
        with self._lock:
            now = self._clock()
            if now - self._period_from < REPORT_S:
                return
            if self._period:
                reasons = ", ".join(f"{reason}: {count}" for reason, count in self._period.most_common())
                logger.warning("%d telemetry message(s) ignored in the last %.0f s (%s)",
                               self._period.total(), now - self._period_from, reasons)
            self._period.clear()
            self._period_from = now

    def _handle(self, topic: str, payload: bytes) -> None:
        match = _TOPIC.fullmatch(topic)
        if match is None:
            return self._refuse("not a sentinel/<id>/telemetry topic", topic)
        sentinel = match.group(1)
        if len(payload) > MAX_PAYLOAD:
            return self._refuse("too big", topic)
        try:
            sample = sample_of(json.loads(payload))
        except (ValueError, RecursionError):  # not UTF-8, not JSON, or nested past the parser's depth
            return self._refuse("not JSON", topic)
        if sample is None:
            return self._refuse("not a telemetry snapshot", topic)
        if self._model is None:
            return
        monitor = self._monitors.get(sentinel)
        if monitor is None:
            if len(self._monitors) >= MAX_SENTINELS:
                return self._refuse("too many Sentinels", topic)
            monitor = self._monitors[sentinel] = Monitor(self._model, sentinel)
            logger.info("Scoring %s", sentinel)
        dropped = monitor.window.dropped
        alert = monitor.push(sample)
        if monitor.window.dropped > dropped:
            return self._refuse("not newer than the last snapshot", topic)
        self._last_ts[sentinel] = sample.ts
        self.fed += 1
        if alert is not None:
            self._emit(alert)

    def _emit(self, alert: dict) -> None:
        sentinel, detail = alert["sentinel"], alert["detail"]
        if alert["state"] == "raised":
            self._open[sentinel] = alert
        else:
            self._open.pop(sentinel, None)
        logger.warning(
            "predictive %s on %s: score %.3f, drivers %s (%s)",
            alert["state"], sentinel, detail["anomaly_score"], ", ".join(detail["drivers"]), alert["alert_id"],
        )
        self._post(alert)

    def _close_episodes(self, why: str) -> None:
        for sentinel, raised in self._open.items():
            # The score and drivers it was raised with: the cleared only closes the episode.
            cleared = {**raised, "state": "cleared", "ts": self._last_ts.get(sentinel, raised["ts"])}
            logger.warning("predictive cleared on %s, %s (%s)", sentinel, why, raised["alert_id"])
            self._post(cleared)
        self._open = {}

    def _refuse(self, reason: str, topic: str) -> None:
        self.invalid[reason] += 1
        if not self._period[reason]:
            # The first of its kind in the period, with its topic; the rest are summed up by report().
            logger.warning("Telemetry on %r ignored: %s", topic[:100], reason)
        self._period[reason] += 1


class _Client(mqtt.Client):
    # paho swallows why a (re)connection failed; this hook lets BrokerLink say it.
    on_connect_error = None

    def reconnect(self):
        try:
            return super().reconnect()
        except OSError as error:
            if self.on_connect_error is not None:
                self.on_connect_error(error)
            raise


class BrokerLink:
    """The service's one connection to the broker, on paho's network thread: subscribes each time it
    comes up, hands each message to the handler, and keeps retrying while the broker is away."""

    def __init__(self, config: Config, handler: TelemetryHandler):
        self._handler = handler
        self._broker = f"{config.mqtt_host}:{config.mqtt_port}"
        self._username = config.mqtt_username
        self._host, self._port = config.mqtt_host, config.mqtt_port
        # A random suffix: two copies of the service (a dev's, the Pi's) would kick each other off
        # the broker in a loop under one client id.
        client = _Client(
            CallbackAPIVersion.VERSION2,
            client_id=f"predictive-{uuid.uuid4().hex[:8]}",
            protocol=mqtt.MQTTv311,
        )
        client.username_pw_set(config.mqtt_username, config.mqtt_password)
        client.tls_set_context(config.tls)
        client.reconnect_delay_set(RECONNECT_MIN_S, RECONNECT_MAX_S)
        client.on_connect = self.on_connect
        client.on_subscribe = self.on_subscribe
        client.on_disconnect = self.on_disconnect
        client.on_message = self.on_message
        client.on_connect_error = self.on_connect_error
        self.client = client
        self._connected = False
        self._stopping = False
        # A broker that stays away fails the same way on every retry: say it once.
        self._last_error: str | None = None

    def start(self) -> None:
        # The first connection is retried like the others: the broker may come up after us.
        self.client.connect_async(self._host, self._port, keepalive=KEEPALIVE_S)
        self.client.loop_start()

    def stop(self) -> None:
        self._stopping = True
        self.client.disconnect()
        self.client.loop_stop()

    def _error(self, text: str) -> None:
        if text != self._last_error:
            self._last_error = text
            logger.warning("MQTT: %s: %s, retrying", self._broker, text)

    def on_connect_error(self, error: OSError) -> None:
        self._error(str(error) or type(error).__name__)

    def on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            # A refused login is retried too: the broker's password file may be fixed while we run.
            self._error(f"refused {self._username}: {reason_code}")
            return
        self._connected = True
        self._last_error = None
        logger.info("MQTT: connected to %s as %s", self._broker, self._username)
        # Each time: the session is clean, the broker forgot our subscription on the way down.
        result, _ = client.subscribe(TOPIC, qos=0)
        if result != mqtt.MQTT_ERR_SUCCESS:
            logger.warning("MQTT: cannot subscribe to %s: %s", TOPIC, mqtt.error_string(result))

    def on_subscribe(self, client, userdata, mid, reason_codes, properties) -> None:
        if any(code.is_failure for code in reason_codes):
            logger.error("MQTT: the broker refused the subscription to %s: check the ACL of %s", TOPIC, self._username)
        else:
            logger.info("MQTT: subscribed to %s", TOPIC)

    def on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        if self._connected and not self._stopping:
            logger.warning("MQTT: lost the connection to %s (%s), retrying", self._broker, reason_code)
        self._connected = False

    def on_message(self, client, userdata, message) -> None:
        try:
            topic = message.topic
        except UnicodeDecodeError:
            topic = ""  # not a topic of ours: counted as such
        self._handler.on_message(topic, message.payload)


def serve(config: Config, stop: threading.Event) -> None:
    """Runs the service until `stop` is set: the network thread scores the telemetry, this one polls
    MODEL_FILE every MODEL_POLL_S and sums up what went wrong."""
    logger.info(
        "Starting: broker mqtts://%s:%d as %s, Alerts to %s, model %s (checked every %g s)",
        config.mqtt_host, config.mqtt_port, config.mqtt_username, config.alerts_url,
        config.model_file, config.model_poll_s,
    )
    store = ModelStore(config.model_file)
    with AlertClient(config.alerts_url, config.token) as alerts:
        handler = TelemetryHandler(alerts.post)
        link = BrokerLink(config, handler)
        link.start()
        try:
            while True:
                model = store.poll()
                if model is not None:
                    handler.use(model)
                handler.report()
                if stop.wait(config.model_poll_s):
                    break
        finally:
            link.stop()
            # Before the client closes, so the cleared Alerts are still sent.
            handler.close()
    logger.info("Stopped: %d telemetry message(s) received, %d ignored", handler.received, handler.invalid.total())


def run() -> None:
    """The service's entry point: reads the configuration, then serves until SIGTERM or SIGINT."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        config = load_config()
    except ConfigError as error:
        raise SystemExit(f"Invalid configuration: {error}") from None
    stop = threading.Event()
    # `docker compose stop` sends SIGTERM: stop at once, send what is queued, exit.
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    serve(config, stop)
