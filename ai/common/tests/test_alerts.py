import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from sentinel_common.alerts import AlertClient
from sentinel_common.contract import alert_errors, iso_utc

TOKEN = "vision-token-0123456789abcdef0123456789abcdef"
# Tiny waits: the retries are under test, not their pace.
FAST = {"timeout": 2.0, "backoff": 0.001, "max_backoff": 0.01}


class FakeApi:
    """POST /api/v1/alerts on 127.0.0.1, answering a script of responses then 202 to everything."""

    def __init__(self):
        self.requests = []
        self.script = []
        self.received = threading.Condition()
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                with api.received:
                    request = {"path": self.path, "headers": dict(self.headers), "body": json.loads(body)}
                    api.requests.append({"at": time.monotonic(), **request})
                    api.received.notify_all()
                    answer = api.script.pop(0) if api.script else 202
                if answer == "drop":
                    # A connection that dies before any answer, as when the api restarts.
                    self.close_connection = True
                    return
                status, headers, delay = (answer, {}, 0) if isinstance(answer, int) else answer
                time.sleep(delay)
                error = {"statusCode": status, "message": f"said {status}"}
                payload = b"" if status == 202 else json.dumps(error).encode()
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/v1/alerts"
        threading.Thread(target=self.server.serve_forever, args=(0.01,), daemon=True).start()

    def bodies(self):
        return [request["body"] for request in self.requests]

    def wait_for(self, count):
        with self.received:
            assert self.received.wait_for(lambda: len(self.requests) >= count, timeout=2)


@pytest.fixture
def api():
    fake = FakeApi()
    yield fake
    fake.server.shutdown()
    fake.server.server_close()


def intrusion(alert_id="vision-1", state="raised"):
    return {
        "alert_id": alert_id,
        "sentinel": "sentinel-01",
        "kind": "intrusion",
        "severity": "critical",
        "state": state,
        "detail": {"x_norm": 0.42, "confidence": 0.88, "bbox": [120, 80, 60, 180]},
        "ts": iso_utc(),
    }


def test_posts_the_alert_as_json_with_the_bearer_token(api):
    alert = intrusion()
    with AlertClient(api.url, TOKEN, **FAST) as client:
        client.post(alert)

    [request] = api.requests
    assert request["path"] == "/api/v1/alerts"
    assert request["headers"]["Authorization"] == f"Bearer {TOKEN}"
    assert request["headers"]["Content-Type"] == "application/json"
    assert request["body"] == alert
    assert alert_errors(request["body"]) == []


def test_post_returns_at_once_while_the_api_is_slow(api):
    api.script = [(202, {}, 0.3)]
    with AlertClient(api.url, TOKEN, **FAST) as client:
        start = time.monotonic()
        client.post(intrusion())
        client.post(intrusion("vision-2"))
        assert time.monotonic() - start < 0.05
    assert len(api.requests) == 2


def test_the_body_is_taken_when_posted(api):
    alert = intrusion()
    with AlertClient(api.url, TOKEN, **FAST) as client:
        client.post(alert)
        alert["state"] = "cleared"
    assert api.bodies()[0]["state"] == "raised"


def test_retries_a_503_until_the_api_takes_the_alert(api):
    api.script = [503, 503]
    with AlertClient(api.url, TOKEN, **FAST) as client:
        client.post(intrusion())
    assert api.bodies() == [api.bodies()[0]] * 3


def test_retries_a_dropped_connection(api):
    api.script = ["drop"]
    with AlertClient(api.url, TOKEN, **FAST) as client:
        client.post(intrusion())
    assert len(api.requests) == 2


def test_retries_a_429_after_its_retry_after(api):
    api.script = [(429, {"Retry-After": "0.3"}, 0)]
    with AlertClient(api.url, TOKEN, timeout=2.0, backoff=0.001, max_backoff=1.0) as client:
        client.post(intrusion())
    first, second = api.requests
    assert second["at"] - first["at"] >= 0.3


def test_a_400_is_not_retried_and_is_logged_with_the_api_message(api, caplog):
    api.script = [400]
    with AlertClient(api.url, TOKEN, **FAST) as client:
        client.post(intrusion("vision-1"))
        client.post(intrusion("vision-2"))
    assert [body["alert_id"] for body in api.bodies()] == ["vision-1", "vision-2"]
    assert "400: said 400" in caplog.text
    assert "vision-1" in caplog.text


def test_gives_up_after_max_attempts_and_goes_on_with_the_next_alert(api, caplog):
    api.script = [503, 503, 503]
    with AlertClient(api.url, TOKEN, max_attempts=3, **FAST) as client:
        client.post(intrusion("vision-1"))
        client.post(intrusion("vision-2"))
    assert [body["alert_id"] for body in api.bodies()] == ["vision-1"] * 3 + ["vision-2"]
    assert "dropped after 3 attempts" in caplog.text


def test_a_cleared_never_overtakes_its_raised(api):
    api.script = [503, (429, {"Retry-After": "0"}, 0), 202, 503]
    alerts = [intrusion(f"vision-{n}", state) for n in range(5) for state in ("raised", "cleared")]
    with AlertClient(api.url, TOKEN, **FAST) as client:
        for alert in alerts:
            client.post(alert)

    sent = [(body["alert_id"], body["state"]) for body in api.bodies()]
    # Retries repeat an Alert in place; the order of the distinct Alerts is the order they were posted.
    assert list(dict.fromkeys(sent)) == [(alert["alert_id"], alert["state"]) for alert in alerts]
    assert len(sent) == len(alerts) + 3


def test_the_token_never_appears_in_the_logs(api, caplog):
    caplog.set_level(logging.DEBUG)
    api.script = [503, (429, {"Retry-After": "0"}, 0), "drop", 400, 401, 503, 503]
    with AlertClient(api.url, TOKEN, max_attempts=2, **FAST) as client:
        for n in range(5):
            client.post(intrusion(f"vision-{n}"))
        assert TOKEN not in repr(client)
    with AlertClient("http://127.0.0.1:1/api/v1/alerts", TOKEN, max_attempts=2, **FAST) as unreachable:
        unreachable.post(intrusion())
    with pytest.raises(ValueError) as refused:
        AlertClient(api.url, TOKEN + " oops")

    assert "Connection refused" in caplog.text
    assert TOKEN not in caplog.text
    assert TOKEN not in str(refused.value)


def test_a_full_queue_drops_the_new_alert_and_says_so(api, caplog):
    api.script = [(202, {}, 0.3)]
    with AlertClient(api.url, TOKEN, max_queue=2, **FAST) as client:
        client.post(intrusion("vision-0"))
        api.wait_for(1)
        for n in range(1, 4):
            client.post(intrusion(f"vision-{n}"))
    assert [body["alert_id"] for body in api.bodies()] == ["vision-0", "vision-1", "vision-2"]
    assert "Alert intrusion vision-3 raised dropped" in caplog.text


def test_close_gives_up_on_an_api_that_stays_down(api, caplog):
    api.script = [503] * 10
    client = AlertClient(api.url, TOKEN, timeout=2.0, backoff=5, max_backoff=5)
    for n in range(3):
        client.post(intrusion(f"vision-{n}"))
    start = time.monotonic()
    client.close(timeout=0.2)
    assert time.monotonic() - start < 1
    assert len(api.requests) == 1
    assert "3 Alert(s) dropped" in caplog.text


def test_close_is_idempotent_and_later_alerts_are_not_sent(api, caplog):
    client = AlertClient(api.url, TOKEN, **FAST)
    client.close()
    client.close()
    client.post(intrusion())
    time.sleep(0.05)
    assert api.requests == []
    assert "the client is closed" in caplog.text


def test_an_alert_that_is_not_json_is_dropped_without_raising(api, caplog):
    alert = intrusion()
    alert["detail"]["confidence"] = float("nan")
    with AlertClient(api.url, TOKEN, **FAST) as client:
        client.post(alert)
        client.post(intrusion("vision-2"))
    assert [body["alert_id"] for body in api.bodies()] == ["vision-2"]
    assert "not JSON" in caplog.text


@pytest.mark.parametrize("url", ["api:8080/api/v1/alerts", "ftp://api/api/v1/alerts", "http:///api/v1/alerts"])
def test_refuses_a_url_that_is_not_http(url):
    with pytest.raises(ValueError):
        AlertClient(url, TOKEN)
