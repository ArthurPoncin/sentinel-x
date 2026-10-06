"""How the AI services post their Alerts: POST /api/v1/alerts with their own token (docs/ARCHITECTURE.md).

A detection loop must never wait on the network, and the api must see an Alert's `cleared` after its
`raised`: post() only queues the Alert, and a single worker thread sends the queue in order, retrying
each Alert until the api takes it, refuses it or the attempts run out, before moving on to the next.
"""

import http.client
import json
import logging
import math
import queue
import threading
import urllib.error
import urllib.request
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

# Queued by close(): the worker stops once everything posted before it is through.
_STOP = object()
# Enough of an error body to read the api's message from.
_MAX_ERROR_BODY = 4096


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # The api never redirects: following one would hand the token to wherever it points.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AlertClient:
    """Posts Alerts to the api in the background, in the order they were posted.

    A network error, a 5xx or a 429 is the api's trouble: the Alert is sent again after an exponential
    backoff, or after the 429's Retry-After, up to `max_attempts` sends in all. Any other refusal is the
    Alert's fault: logged with the api's message, then skipped. Use it as a context manager, or call
    close() before exiting: what is still queued at exit is lost.
    """

    def __init__(
        self,
        url: str,
        token: str,
        *,
        timeout: float = 2.0,
        max_attempts: int = 5,
        backoff: float = 0.5,
        max_backoff: float = 8.0,
        max_queue: int = 1000,
    ) -> None:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError(f"Expected an http:// or https:// URL, got {url!r}")
        # It travels in a header. Never echoed: errors end up in logs.
        if not token or any(char.isspace() for char in token):
            raise ValueError("Expected a token without spaces")
        if max_attempts < 1:
            raise ValueError("Expected at least 1 attempt")
        self.url = url
        self._authorization = f"Bearer {token}"
        self._timeout = timeout
        self._max_attempts = max_attempts
        self._backoff = backoff
        self._max_backoff = max_backoff
        self._max_queue = max_queue
        # The api is on the internal Docker network: never through a proxy taken from the environment,
        # which would see the token, and never after a redirect.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)
        # Unbounded so that close() can always queue _STOP; post() keeps it to max_queue Alerts.
        self._queue: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        self._closed = False
        self._abort = threading.Event()
        # A daemon: a service that forgets close() still exits.
        self._worker = threading.Thread(target=self._run, name="alert-client", daemon=True)
        self._worker.start()

    def __repr__(self) -> str:
        return f"AlertClient({self.url!r})"

    def __enter__(self) -> "AlertClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def post(self, alert: dict) -> None:
        """Queues the Alert and returns at once. The body is taken now: changing the dict later changes nothing."""
        name = _describe(alert)
        try:
            body = json.dumps(alert, allow_nan=False).encode()
        except (TypeError, ValueError) as error:
            # A NaN score, say: the api could not take it, and the caller's loop must go on.
            logger.error("Alert %s dropped: not JSON (%s)", name, error)
            return
        with self._lock:
            if self._closed:
                logger.error("Alert %s dropped: the client is closed", name)
            elif self._queue.qsize() >= self._max_queue:
                logger.error("Alert %s dropped: %d Alerts already wait for the api", name, self._max_queue)
            else:
                self._queue.put((name, body))

    def close(self, timeout: float = 5.0) -> None:
        """Sends what is queued, then stops. What is still unsent after `timeout` seconds is dropped."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._queue.put(_STOP)
        self._worker.join(timeout)
        if self._worker.is_alive():
            # Ends a wait between two attempts at once; a send in flight lasts `timeout` at most.
            self._abort.set()
            self._worker.join(self._timeout)

    def _run(self) -> None:
        dropped = 0
        while (item := self._queue.get()) is not _STOP:
            try:
                if self._abort.is_set() or not self._send(*item):
                    dropped += 1
            except Exception:
                # Whatever happens to one Alert, the next ones still go.
                logger.exception("Alert %s dropped: unexpected error", item[0])
        if dropped:
            logger.error("%d Alert(s) dropped: the client closed before the api took them", dropped)

    def _send(self, name: str, body: bytes) -> bool:
        """Done with the Alert: taken, refused or out of attempts. False when close() cut it short."""
        request = urllib.request.Request(
            self.url,
            data=body,
            method="POST",
            headers={"Authorization": self._authorization, "Content-Type": "application/json"},
        )
        for attempt in range(1, self._max_attempts + 1):
            retry_after = None
            try:
                with self._opener.open(request, timeout=self._timeout) as response:
                    response.read()
                return True
            except urllib.error.HTTPError as error:
                status, message = error.code, _message(error)
                if status != 429 and status < 500:
                    logger.error("api refused Alert %s with %d: %s", name, status, message)
                    return True
                retry_after = _retry_after(error.headers.get("Retry-After"))
                problem = f"{status} {message}"
            except (OSError, http.client.HTTPException) as error:
                # URLError (refused, unreachable, timed out) and a connection dropped mid-answer.
                problem = str(error) or type(error).__name__
            if attempt == self._max_attempts:
                logger.error("Alert %s dropped after %d attempts, the last one: %s", name, attempt, problem)
                return True
            # Retry-After too is capped: a stuck queue would hold back every Alert behind this one.
            delay = self._backoff * 2 ** (attempt - 1) if retry_after is None else retry_after
            delay = min(delay, self._max_backoff)
            logger.warning(
                "Alert %s not taken (%s), attempt %d/%d, next in %.3g s",
                name, problem, attempt, self._max_attempts, delay,
            )
            if self._abort.wait(delay):
                return False
        return True


def _describe(alert: object) -> str:
    # What a log line needs to find the Alert again; never the whole body.
    if not isinstance(alert, dict):
        return f"({type(alert).__name__}, not an object)"
    return " ".join(str(alert.get(key, "?")) for key in ("kind", "alert_id", "state"))


def _message(error: urllib.error.HTTPError) -> str:
    # The api answers { statusCode, error, message }, like the errors Fastify raises on its own.
    try:
        text = error.read(_MAX_ERROR_BODY).decode("utf-8", "replace")
    except (OSError, http.client.HTTPException):
        text = ""
    finally:
        error.close()
    try:
        payload = json.loads(text)
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("message"), str):
        return payload["message"]
    return text.strip()[:200] or str(error.reason)


def _retry_after(value: str | None) -> float | None:
    # The api sends whole seconds. An HTTP date, which it never sends, falls back to the backoff.
    try:
        seconds = float(value) if value is not None else math.nan
    except ValueError:
        return None
    return seconds if math.isfinite(seconds) and seconds >= 0 else None
