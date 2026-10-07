import dataclasses
import json
import logging
import socket
import ssl
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import joblib
import numpy as np
import pytest
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.reasoncodes import ReasonCode

from sentinel_common.alerts import AlertClient
from sentinel_common.config import ConfigError
from sentinel_common.contract import alert_errors

from predictive import __main__, service, synthetic
from predictive.features import SlidingWindow
from predictive.model import Verdict
from predictive.service import BrokerLink, ModelStore, TelemetryHandler, load_config

TOKEN = "predictive-token-0123456789abcdef0123456789abcdef"
PASSWORD = "mqtt-password-fedcba9876543210fedcba98"
# A throwaway self-signed CA, certificate only (its key was never kept): enough to build a TLS context.
CA_PEM = """-----BEGIN CERTIFICATE-----
MIIBjzCCATegAwIBAgIUdS3qPGpKKbSRTHLWf1iCcceopkQwCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSU2VudGluZWwtWCB0ZXN0IENBMCAXDTI2MTAwNjA5MzgwMloY
DzIxMjYwOTEyMDkzODAyWjAdMRswGQYDVQQDDBJTZW50aW5lbC1YIHRlc3QgQ0Ew
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASBTA2cXkoIQdK5yqdEr90Kpd+JkYLT
QETWUI5s8Nhzoy7ub0R5E8prZ0sSO6zd/d5NSch5yW1Sr5HneIXkH5VOo1MwUTAd
BgNVHQ4EFgQU+nuYI7yWeduXTSrJEkOX+ZIj0hQwHwYDVR0jBBgwFoAU+nuYI7yW
eduXTSrJEkOX+ZIj0hQwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNGADBD
Ah95sEDuLT6Hhzo3knsqH3IaxmWDIEA9i9t9OHt0NOUmAiA45vUvF6/SlqKrXD3t
BXz9Qujm55LGjUpQFXNksmhXgQ==
-----END CERTIFICATE-----
"""


class FakeApi:
    """POST /api/v1/alerts on 127.0.0.1, answering 202 to everything."""

    def __init__(self):
        self.requests = []
        self.received = threading.Condition()
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                with api.received:
                    api.requests.append({"headers": dict(self.headers), "body": json.loads(body)})
                    api.received.notify_all()
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/v1/alerts"
        threading.Thread(target=self.server.serve_forever, args=(0.01,), daemon=True).start()

    def bodies(self):
        return [request["body"] for request in self.requests]


@pytest.fixture
def api():
    fake = FakeApi()
    yield fake
    fake.server.shutdown()
    fake.server.server_close()


class StubModel:
    """Duck-types a Model for the handler: a 10 s window of 3 snapshots, scored 0.9 from 30 °C on
    and 0.5 below. Fast and predictable; the real model goes through the end-to-end test."""

    raise_level, clear_level = 0.6, 0.55

    def __init__(self, name="stub"):
        self.name = name

    def window(self):
        return SlidingWindow(10, 3)

    def judge(self, vectors):
        return [Verdict(0.9 if row[0] >= 30 else 0.5, ["temp"]) for row in np.atleast_2d(vectors)]


def snapshot(second, temp=25.0):
    ts = (synthetic.START + timedelta(seconds=second)).strftime("%Y-%m-%dT%H:%M:%SZ")
    readings = {"temp": temp, "humidity": 45.0, "air": 250}
    return json.dumps({"sentinel": "sentinel-01", "ts": ts, "readings": readings}).encode()


def feed(handler, topic, temps, start=0):
    for i, temp in enumerate(temps):
        handler.on_message(topic, snapshot(start + i, temp))


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


# --- Telemetry → Alerts --------------------------------------------------------------------------


def test_a_drift_in_the_live_telemetry_is_posted_as_a_raised_then_a_cleared_alert(model, api):
    # The reference drift, shortened: 2 min at rest, heat + gas rising for 4 min, back down in 1, at
    # rest again. One snapshot every 2 s, as the Sentinel publishes them.
    scenario = synthetic.drift(1, synthetic.START + timedelta(hours=2), 2, 4, 1, 2.5)
    with AlertClient(api.url, TOKEN) as alerts:
        handler = TelemetryHandler(alerts.post)
        handler.use(model)
        for payload in scenario.payloads[::2]:
            # The payload says sentinel-01: the topic is what counts.
            handler.on_message("sentinel/sentinel-07/telemetry", json.dumps(payload).encode())

    raised, cleared = api.bodies()
    assert (raised["state"], cleared["state"]) == ("raised", "cleared")
    assert raised["alert_id"] == cleared["alert_id"]
    assert raised["sentinel"] == cleared["sentinel"] == "sentinel-07"
    assert raised["kind"] == "predictive"
    # Raised during the drift, cleared once the room is back at rest.
    assert scenario.drift_from < datetime.fromisoformat(raised["ts"]).timestamp() < scenario.peak_at
    assert datetime.fromisoformat(cleared["ts"]).timestamp() > scenario.nominal_from
    assert all(alert_errors(body) == [] for body in api.bodies())
    assert {request["headers"]["Authorization"] for request in api.requests} == {f"Bearer {TOKEN}"}
    assert handler.invalid.total() == 0


def test_a_drift_on_one_sentinel_leaves_the_others_alone():
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    for second in range(40):
        # Interleaved, as they arrive: sentinel-01 heats up after 10 s, sentinel-02 stays at rest.
        handler.on_message("sentinel/sentinel-01/telemetry", snapshot(second, 35.0 if second >= 10 else 25.0))
        handler.on_message("sentinel/sentinel-02/telemetry", snapshot(second, 25.0))

    [alert] = posted
    assert (alert["sentinel"], alert["state"]) == ("sentinel-01", "raised")
    assert alert_errors(alert) == []


def test_each_sentinel_has_its_own_window():
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    feed(handler, "sentinel/sentinel-01/telemetry", [25.0] * 20, start=100)
    # Older than sentinel-01's last snapshot, yet new to sentinel-02: taken, not dropped as stale.
    feed(handler, "sentinel/sentinel-02/telemetry", [35.0] * 10, start=0)
    assert handler.invalid.total() == 0
    assert [(a["sentinel"], a["state"]) for a in posted] == [("sentinel-02", "raised")]


@pytest.mark.parametrize(
    "topic",
    [
        "sentinel/sentinel-01/alert",
        "sentinel/sentinel-01/telemetry/extra",
        "sentinel//telemetry",
        "sentinel/a b/telemetry",
        "sentinel/é/telemetry",
        "sentinel/" + "x" * 65 + "/telemetry",
        "command/sentinel-01/actuator",
        "",
    ],
)
def test_a_message_on_a_foreign_topic_is_ignored_and_counted(topic):
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    feed(handler, topic, [35.0] * 20)
    assert posted == []
    assert handler.invalid == {"not a sentinel/<id>/telemetry topic": 20}


@pytest.mark.parametrize(
    "payload, reason",
    [
        (b"not json", "not JSON"),
        (b"\xff\xfe", "not JSON"),
        (b"[" * 5000, "too big"),
        (b"[1, 2]", "not a telemetry snapshot"),
        (b'{"ts": "2026-10-06T08:00:00Z"}', "not a telemetry snapshot"),
        (b'{"ts": "2026-10-06T08:00:00", "readings": {"temp": 25, "humidity": 45, "air": 250}}', "not a telemetry snapshot"),
        (b'{"ts": "2026-10-06T08:00:00Z", "readings": {"temp": "hot", "humidity": 45, "air": 250}}', "not a telemetry snapshot"),
    ],
    ids=["text", "not utf-8", "too big", "array", "no readings", "ts without offset", "not a number"],
)
def test_an_invalid_payload_is_ignored_and_counted_never_fatal(payload, reason):
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    handler.on_message("sentinel/sentinel-01/telemetry", payload)
    assert handler.invalid == {reason: 1}
    # The stream goes on as if nothing had happened.
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 10)
    assert [a["state"] for a in posted] == ["raised"]


def test_a_payload_nested_deep_is_ignored_and_counted_never_fatal():
    # Within the size limit: parsed (Python 3.12 and later) or refused by the parser's depth (3.11), never
    # a crash.
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    handler.on_message("sentinel/sentinel-01/telemetry", b"[" * 2000 + b"]" * 2000)
    assert handler.invalid in ({"not a telemetry snapshot": 1}, {"not JSON": 1})
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 10)
    assert [a["state"] for a in posted] == ["raised"]


def test_a_snapshot_not_newer_than_the_last_one_is_counted():
    handler = TelemetryHandler(lambda alert: None)
    handler.use(StubModel())
    feed(handler, "sentinel/sentinel-01/telemetry", [25.0] * 5, start=10)
    feed(handler, "sentinel/sentinel-01/telemetry", [25.0], start=12)
    assert handler.invalid == {"not newer than the last snapshot": 1}


def test_invalid_messages_are_logged_once_per_period_then_summed_up(caplog):
    clock = Clock()
    handler = TelemetryHandler(lambda alert: None, clock=clock)
    with caplog.at_level(logging.WARNING, logger="predictive"):
        for _ in range(100):
            handler.on_message("sentinel/sentinel-01/telemetry", b"garbage")
            handler.on_message("sentinel/a b/telemetry", snapshot(0))
        handler.report()  # the period is not over yet: nothing to say
        assert len(caplog.records) == 2
        clock.now += service.REPORT_S
        handler.report()
    assert len(caplog.records) == 3
    assert "200 telemetry message(s) ignored" in caplog.records[-1].getMessage()
    assert "not JSON: 100" in caplog.records[-1].getMessage()
    # A new period: the first refusal of each kind gets its line again.
    with caplog.at_level(logging.WARNING, logger="predictive"):
        handler.on_message("sentinel/sentinel-01/telemetry", b"garbage")
    assert len(caplog.records) == 4


def test_a_failing_post_does_not_stop_the_handler():
    def post(alert):
        raise RuntimeError("boom")

    handler = TelemetryHandler(post)
    handler.use(StubModel())
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 10)
    assert handler.invalid["unexpected error"] >= 1
    assert handler.received == 10


# --- Without a model, then with one --------------------------------------------------------------


def test_without_a_model_nothing_is_scored_until_the_model_file_appears(model, tmp_path, caplog):
    posted = []
    handler = TelemetryHandler(posted.append)
    store = ModelStore(str(tmp_path / "model.joblib"))
    with caplog.at_level(logging.INFO, logger="predictive"):
        assert store.poll() is None
        feed(handler, "sentinel/sentinel-01/telemetry", [25.0] * 30)
    assert handler.received == 30 and handler.fed == 0 and posted == []
    assert "No model at" in caplog.text

    model.save(tmp_path / "model.joblib")
    with caplog.at_level(logging.INFO, logger="predictive"):
        loaded = store.poll()
    assert loaded is not None
    # Its range and levels, for whoever reads the logs.
    assert f"{model.trained_on} vectors of {model.data_from} → {model.data_to}" in caplog.text
    assert f"raise at {model.raise_level:.3f}" in caplog.text
    handler.use(loaded)
    feed(handler, "sentinel/sentinel-01/telemetry", [25.0] * 30, start=100)
    assert handler.fed == 30
    # Unchanged: nothing to load again.
    assert store.poll() is None


def test_the_missing_model_is_recalled_periodically(tmp_path, caplog):
    clock = Clock()
    store = ModelStore(str(tmp_path / "model.joblib"), clock=clock)
    with caplog.at_level(logging.WARNING, logger="predictive"):
        for _ in range(10):
            store.poll()
        clock.now += service.REPORT_S
        store.poll()
    assert caplog.text.count("No model at") == 2


def test_a_replaced_model_file_is_loaded_again(model, tmp_path):
    path = tmp_path / "model.joblib"
    model.save(path)
    store = ModelStore(str(path))
    first = store.poll()
    assert first.trained_on == model.trained_on

    dataclasses.replace(model, trained_on=12345).save(path)
    second = store.poll()
    assert second is not None and second.trained_on == 12345


@pytest.mark.parametrize("content", [b"", b"garbage", "foreign"])
def test_a_broken_model_file_is_logged_and_the_previous_model_kept(model, tmp_path, caplog, content):
    path = tmp_path / "model.joblib"
    model.save(path)
    store = ModelStore(str(path))
    assert store.poll() is not None

    if content == "foreign":
        joblib.dump({"not": "a model"}, path)
    else:
        path.write_bytes(content)
    with caplog.at_level(logging.ERROR, logger="predictive"):
        assert store.poll() is None
        # Logged once, not at every poll.
        assert store.poll() is None
    assert caplog.text.count("cannot be loaded, keeping the current model") == 1

    # Fixed: taken up again.
    model.save(path)
    assert store.poll() is not None


def test_a_deleted_model_file_keeps_the_model_in_memory(model, tmp_path, caplog):
    path = tmp_path / "model.joblib"
    model.save(path)
    store = ModelStore(str(path))
    assert store.poll() is not None
    path.unlink()
    with caplog.at_level(logging.WARNING, logger="predictive"):
        assert store.poll() is None
        assert store.poll() is None
    assert caplog.text.count("is gone") == 1


def test_a_new_model_starts_every_sentinel_over_and_clears_its_open_alerts():
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel("first"))
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 10)
    feed(handler, "sentinel/sentinel-02/telemetry", [25.0] * 10)
    [raised] = posted

    handler.use(StubModel("second"))
    _, cleared = posted
    assert (cleared["state"], cleared["sentinel"]) == ("cleared", "sentinel-01")
    assert cleared["alert_id"] == raised["alert_id"]
    # The ts of the last snapshot the episode saw.
    assert cleared["ts"] == json.loads(snapshot(9))["ts"]
    assert alert_errors(cleared) == []

    # A fresh window: 2 snapshots are too few to score, so nothing is raised again yet.
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 2, start=10)
    assert len(posted) == 2
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 10, start=12)
    assert posted[-1]["state"] == "raised" and posted[-1]["alert_id"] != raised["alert_id"]


def test_closing_clears_the_open_alerts():
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    feed(handler, "sentinel/sentinel-01/telemetry", [35.0] * 10)
    handler.close()
    assert [a["state"] for a in posted] == ["raised", "cleared"]
    handler.close()
    assert len(posted) == 2


# --- Configuration -------------------------------------------------------------------------------


@pytest.fixture
def env(monkeypatch, tmp_path):
    ca = tmp_path / "ca.crt"
    ca.write_text(CA_PEM)
    values = {
        "MQTT_URL": "mqtts://mosquitto:8883",
        "MQTT_PASSWORD": PASSWORD,
        "MQTT_CA_FILE": str(ca),
        "PREDICTIVE_TOKEN": TOKEN,
    }
    for name in ("MQTT_USERNAME", "ALERTS_URL", "MODEL_FILE", "MODEL_POLL_S"):
        monkeypatch.delenv(name, raising=False)
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    return monkeypatch


def test_the_configuration_comes_from_the_environment_with_its_defaults(env):
    config = load_config()
    assert (config.mqtt_host, config.mqtt_port, config.mqtt_username) == ("mosquitto", 8883, "predictive")
    assert config.mqtt_password == PASSWORD and config.token == TOKEN
    assert config.alerts_url == "http://api:8080/api/v1/alerts"
    assert (config.model_file, config.model_poll_s) == ("/model/model.joblib", 10.0)
    # Neither secret in its repr: a config may end up in a log.
    assert TOKEN not in repr(config) and PASSWORD not in repr(config)


def test_the_broker_is_verified_against_the_team_ca(env):
    tls = load_config().tls
    assert tls.verify_mode == ssl.CERT_REQUIRED
    assert tls.check_hostname is True
    assert tls.minimum_version >= ssl.TLSVersion.TLSv1_2
    assert len(tls.get_ca_certs()) == 1


def test_the_port_defaults_to_8883(env):
    env.setenv("MQTT_URL", "mqtts://broker.local")
    assert load_config().mqtt_port == 8883


@pytest.mark.parametrize(
    "name, value, message",
    [
        ("MQTT_URL", "mqtt://mosquitto:1883", "MQTT_URL: expected an mqtts:// URL"),
        ("MQTT_URL", "http://mosquitto:8883", "MQTT_URL: expected an mqtts:// URL"),
        ("MQTT_URL", "mqtts://:8883", "MQTT_URL: expected an mqtts:// URL"),
        ("MQTT_URL", "mqtts://mosquitto:port", "MQTT_URL: invalid port"),
        ("MQTT_URL", "mqtts://[mosquitto:8883", "MQTT_URL: not a URL"),
        ("MQTT_URL", None, "MQTT_URL is required"),
        ("MQTT_PASSWORD", None, "MQTT_PASSWORD is required"),
        ("MQTT_CA_FILE", None, "MQTT_CA_FILE is required"),
        ("MQTT_CA_FILE", "/nowhere/ca.crt", "MQTT_CA_FILE: no file at '/nowhere/ca.crt'"),
        ("PREDICTIVE_TOKEN", None, "PREDICTIVE_TOKEN is required"),
        ("PREDICTIVE_TOKEN", "short-token", "PREDICTIVE_TOKEN: too short"),
        ("ALERTS_URL", "api:8080", "ALERTS_URL: expected an http:// or https:// URL"),
        ("MODEL_POLL_S", "0", "MODEL_POLL_S: expected a number >= 0.1"),
    ],
)
def test_a_bad_variable_stops_the_service_with_its_name(env, name, value, message):
    if value is None:
        env.delenv(name)
    else:
        env.setenv(name, value)
    with pytest.raises(ConfigError, match="^" + message.replace(".", r"\.")):
        load_config()


def test_a_ca_file_that_is_no_certificate_is_refused(env, tmp_path):
    (tmp_path / "ca.crt").write_text("not a certificate")
    with pytest.raises(ConfigError, match="^MQTT_CA_FILE: .* is not a readable PEM certificate"):
        load_config()


@pytest.mark.parametrize("url", [f"mqtts://predictive:{PASSWORD}@mosquitto:8883", f"mqtt://predictive:{PASSWORD}@mosquitto:x"])
def test_credentials_in_the_url_are_refused_without_echoing_them(env, url):
    env.setenv("MQTT_URL", url)
    with pytest.raises(ConfigError, match="^MQTT_URL: put the credentials in") as error:
        load_config()
    assert PASSWORD not in str(error.value)


def test_run_exits_with_the_variable_s_name(env):
    env.setenv("MQTT_URL", "mqtt://mosquitto:1883")
    with pytest.raises(SystemExit, match="^Invalid configuration: MQTT_URL"):
        __main__.main(["run"])


# --- The broker link ----------------------------------------------------------------------------


def success():
    return ReasonCode(PacketTypes.CONNACK, identifier=0)


def test_it_subscribes_each_time_the_connection_comes_up(env):
    link = BrokerLink(load_config(), TelemetryHandler(lambda alert: None))
    calls = []
    client = SimpleNamespace(subscribe=lambda topic, qos: calls.append((topic, qos)) or (0, 1))
    link.on_connect(client, None, None, success(), None)
    link.on_disconnect(client, None, None, success(), None)
    link.on_connect(client, None, None, success(), None)
    assert calls == [("sentinel/+/telemetry", 0)] * 2


def test_a_refused_login_is_logged_once_and_subscribes_to_nothing(env, caplog):
    link = BrokerLink(load_config(), TelemetryHandler(lambda alert: None))
    calls = []
    client = SimpleNamespace(subscribe=lambda topic, qos: calls.append(topic) or (0, 1))
    refused = ReasonCode(PacketTypes.CONNACK, identifier=0x87)  # Not authorized
    with caplog.at_level(logging.WARNING, logger="predictive"):
        for _ in range(3):
            link.on_connect(client, None, None, refused, None)
    assert calls == []
    assert caplog.text.count("refused predictive: Not authorized") == 1


def test_messages_reach_the_handler(env):
    posted = []
    handler = TelemetryHandler(posted.append)
    handler.use(StubModel())
    link = BrokerLink(load_config(), handler)
    for second in range(10):
        message = SimpleNamespace(topic="sentinel/sentinel-01/telemetry", payload=snapshot(second, 35.0))
        link.on_message(None, None, message)
    assert handler.received == 10 and [a["state"] for a in posted] == ["raised"]


def closed_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_the_service_retries_an_absent_broker_takes_up_the_model_and_stops_at_once(env, model, tmp_path, api, caplog):
    path = tmp_path / "model.joblib"
    model.save(path)
    env.setenv("MQTT_URL", f"mqtts://127.0.0.1:{closed_port()}")
    env.setenv("ALERTS_URL", api.url)
    env.setenv("MODEL_FILE", str(path))
    env.setenv("MODEL_POLL_S", "0.1")
    config = load_config()
    stop = threading.Event()
    with caplog.at_level(logging.DEBUG):
        runner = threading.Thread(target=service.serve, args=(config, stop))
        runner.start()
        deadline = time.monotonic() + 3
        while "MQTT: 127.0.0.1" not in caplog.text and time.monotonic() < deadline:
            time.sleep(0.02)
        start = time.monotonic()
        stop.set()
        runner.join(5)
    assert not runner.is_alive()
    assert time.monotonic() - start < 3
    assert "Model loaded from" in caplog.text
    # Why it cannot connect, once, then retrying.
    assert caplog.text.count("Connection refused, retrying") == 1
    # No secret in any line, whatever its logger.
    assert TOKEN not in caplog.text and PASSWORD not in caplog.text
