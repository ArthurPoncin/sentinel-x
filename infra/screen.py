#!/usr/bin/env python3
"""The Command Post's status screen, on the Pi's HDMI console (tty1): the table Wi-Fi, the Sentinel,
its last readings and raised Alerts, the webcam and the stack, redrawn every second. What the brief's
OLED showed on the Sentinel, on a screen plugged into the Pi instead. Run by the sentinel-x-screen
systemd unit that infra/plug-and-play.sh installs:
    python3 infra/screen.py <table number>

The Python of the Pi OS, nothing to install but python3-paho-mqtt (plug-and-play.sh does). It reads
the broker with its own MQTT account, `screen`, which may only read the Sentinels' telemetry and
Alerts (infra/mosquitto/acl); Docker, NetworkManager and the DHCP leases with the user's own rights.
The Alerts of vision and predictive go to the api, not to the broker: the dashboard shows them.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

REPO = Path(__file__).resolve().parent.parent
SECRETS = REPO / "infra" / "secrets"
LEASES = Path("/var/lib/misc/dnsmasq.leases")
WEBCAMS = Path("/dev/v4l/by-id")
# The largest Terminus there is: 50 columns by 15 rows on the 800x480 screen, readable from afar.
FONTS = [
    Path("/usr/share/consolefonts") / name
    for name in ("Lat15-TerminusBold32x16.psf.gz", "Uni2-TerminusBold32x16.psf.gz", "Lat15-TerminusBold28x14.psf.gz")
]
# The Sentinel sends a snapshot a second: without one for this long, it is no longer online.
ONLINE_S = 10
# Docker, the access point and the DHCP leases are read this often; the screen is drawn every second.
POLL_S = 5

KINDS = {"gas": "gaz", "thermal": "température", "presence": "présence", "noise": "bruit"}

RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
RED, GREEN, YELLOW, CYAN = "\033[31m", "\033[32m", "\033[33m", "\033[36m"
SEVERITY_COLOURS = {"critical": RED + BOLD, "warning": YELLOW, "info": CYAN}
ESCAPE = re.compile(r"\033\[[0-9;?]*[A-Za-z]")


def pill(text: str, background: int) -> str:
    """A word on a coloured background: 41 red, 42 green, 43 yellow."""
    return f"\033[30;{background}m {text} {RESET}"


def printable(text: object, size: int) -> str:
    """What came from the network, without what the console would take for a command."""
    return "".join(c for c in str(text) if c.isprintable())[:size]


def number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def env_value(path: Path, key: str) -> str | None:
    try:
        for line in path.read_text().splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1]
    except OSError:
        pass
    return None


@dataclass
class Snapshot:
    connected: bool
    problem: str
    readings: dict | None
    age: float | None  # seconds since the last telemetry, None before the first
    alerts: list[tuple[str, str]]  # (kind, severity), in the order they were raised


@dataclass
class Sentinel:
    """What the broker said about the Sentinel, written by paho's thread, read by the screen's."""

    lock: threading.Lock = field(default_factory=threading.Lock)
    connected: bool = False
    problem: str = "connexion au broker…"
    readings: dict | None = None
    seen_at: float | None = None
    alerts: dict[str, tuple[str, str]] = field(default_factory=dict)  # alert_id → (kind, severity)

    def take(self, topic: str, payload: bytes) -> None:
        try:
            data = json.loads(payload)
        except ValueError:
            return
        if not isinstance(data, dict):
            return
        with self.lock:
            if topic.endswith("/telemetry") and isinstance(data.get("readings"), dict):
                self.readings, self.seen_at = data["readings"], time.monotonic()
            elif topic.endswith("/alert") and isinstance(data.get("alert_id"), str):
                if data.get("state") == "cleared":
                    self.alerts.pop(data["alert_id"], None)
                elif data.get("state") == "raised":
                    # A raised again with another severity replaces the first, in its place.
                    self.alerts[data["alert_id"]] = (str(data.get("kind")), str(data.get("severity")))

    def snapshot(self, now: float) -> Snapshot:
        with self.lock:
            age = None if self.seen_at is None else now - self.seen_at
            if age is None or age > ONLINE_S:
                # Gone, it may come back from a reboot that forgot them: on reconnecting, it sends
                # every Alert it still has raised again.
                self.alerts.clear()
            return Snapshot(self.connected, self.problem, self.readings, age, list(self.alerts.values()))


def listen(pi_ip: str, sentinel: Sentinel):
    """Follows the Sentinels' topics in the background, reconnecting on its own. None when it cannot."""
    password = env_value(SECRETS / "screen.env", "MQTT_PASSWORD")
    if mqtt is None:
        sentinel.problem = "paho-mqtt manque : relance le script"
        return None
    if not password:
        sentinel.problem = "pas de compte screen : relance le script"
        return None
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="screen")
    except AttributeError:  # paho-mqtt 1.x, before its callbacks changed
        client = mqtt.Client(client_id="screen")

    def on_connect(client, _userdata, _flags, reason, _properties=None):
        refused = reason != 0
        with sentinel.lock:
            sentinel.connected = not refused
            text = mqtt.connack_string(reason) if isinstance(reason, int) else str(reason)
            sentinel.problem = f"broker : {printable(text, 30)}" if refused else ""
        if not refused:
            client.subscribe([("sentinel/+/telemetry", 0), ("sentinel/+/alert", 1)])

    def on_disconnect(_client, _userdata, *_args):
        with sentinel.lock:
            sentinel.connected, sentinel.problem = False, "broker injoignable"

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = lambda _client, _userdata, message: sentinel.take(message.topic, message.payload)
    client.username_pw_set("screen", password)
    try:
        # The broker's certificate names the Pi by its IP: checked against the team CA, like the ESP32 does.
        client.tls_set(ca_certs=str(SECRETS / "ca.crt"))
    except (OSError, ValueError) as error:
        sentinel.problem = f"certificat : {printable(error, 30)}"
        return None
    client.reconnect_delay_set(1, 10)
    client.connect_async(pi_ip, 8883, keepalive=30)
    client.loop_start()
    return client


def run(*command: str) -> str | None:
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=5, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def poll(sentinel_ip: str) -> dict:
    """What the Pi itself says: its access point, the Sentinel on it, the webcam, the containers."""
    active = run("nmcli", "-t", "-f", "NAME", "connection", "show", "--active")
    # The Sentinel's MAC by its reserved address; then whether the access point has it right now: a
    # lease lasts 12 h, long after the ESP32 went off.
    mac = None
    try:
        for line in LEASES.read_text().splitlines():
            fields = line.split()
            if fields[2:3] == [sentinel_ip]:
                mac = fields[1].lower()
    except OSError:
        pass
    stations = run("iw", "dev", "wlan0", "station", "dump")
    if stations is None:
        on_wifi = mac is not None  # without iw, its lease is the best clue there is
    else:
        on_wifi = mac is not None and f"station {mac} " in stations.lower()
    listing = run(
        "docker", "ps", "-a",
        "--filter", f"label=com.docker.compose.project.working_dir={REPO}",
        "--filter", "label=com.docker.compose.oneoff=False",
        "--format", '{{.Label "com.docker.compose.service"}}\t{{.State}}\t{{.Status}}',
    )
    containers = None
    if listing is not None:
        containers = {}
        for line in listing.splitlines():
            service, state, status = (line.split("\t") + ["", ""])[:3]
            if state != "running":
                containers[service] = "down"
            elif "(unhealthy)" in status:
                containers[service] = "unhealthy"
            elif "(health: starting)" in status:
                containers[service] = "starting"
            else:
                containers[service] = "ok"
    return {
        "access_point": None if active is None else "sentinel-x-ap" in active.splitlines(),
        "on_wifi": on_wifi,
        "webcam": any(WEBCAMS.glob("usb-*-video-index0")),
        "containers": containers,
    }


def alert(kind: str, severity: str) -> str:
    """A raised Alert in its severity's colour, in capitals when critical: « GAZ · température »."""
    name = KINDS.get(kind) or printable(kind, 12)
    return SEVERITY_COLOURS.get(severity, "") + (name.upper() if severity == "critical" else name) + RESET


def ago(seconds: float) -> str:
    return f"{seconds:.0f} s" if seconds < 90 else f"{seconds / 60:.0f} min"


def render(width: int, table: int, ssid: str, pi_ip: str, sentinel_ip: str, system: dict, seen: Snapshot) -> list[str]:
    def row(label: str, value: str) -> str:
        return f" {BOLD}{label:<10}{RESET}{value}"

    def pair(label: str, value: str, label2: str, value2: str, style: str = "") -> str:
        return f" {BOLD}{label:<10}{RESET}{style}{value:<14}{RESET}{BOLD}{label2:<10}{RESET}{style}{value2}{RESET}"

    title, clock = f" SENTINEL-X · table {table}", f"{datetime.now():%H:%M:%S} "
    lines = [f"\033[30;46m{title}{' ' * max(1, width - len(title) - len(clock))}{clock}{RESET}", ""]

    access_point = {True: "  " + pill("ACTIF", 42), False: "  " + pill("ARRÊTÉ", 41), None: ""}
    lines += [
        row("Wi-Fi", ssid + access_point[system.get("access_point")]),
        row("Pi", pi_ip),
        row("Dashboard", f"https://{pi_ip}/"),
        "",
    ]

    online = seen.age is not None and seen.age <= ONLINE_S
    if online:
        state = f"{pill('EN LIGNE', 42)}  {sentinel_ip} · il y a {ago(seen.age)}"
    elif not seen.connected:
        state = pill("BROKER ?", 43)
    elif system.get("on_wifi") and seen.age is not None:
        state = f"{pill('MUET', 43)}  {sentinel_ip} · depuis {ago(seen.age)}"
    elif system.get("on_wifi"):
        state = f"{pill('SUR LE WI-FI', 43)}  {sentinel_ip}"
    else:
        state = f"{pill('ABSENT', 41)}  pas sur le Wi-Fi"
    lines.append(row("Sentinel", state))
    if not seen.connected:
        lines.append(row("", seen.problem))

    readings = seen.readings or {}
    # Readings that are no longer fresh stay, greyed.
    shade = "" if online else DIM
    if any(number(readings.get(key)) for key in ("temp", "humidity", "air", "sound")):
        def shown(key: str, form: str) -> str:
            value = readings.get(key)
            return form.format(value) if number(value) else "-"

        presence = {True: "oui", False: "non"}.get(readings.get("pir"), "-")
        lines += [
            pair("Temp.", shown("temp", "{:.1f} °C"), "Humidité", shown("humidity", "{:.0f} %"), shade),
            pair("Gaz", shown("air", "{:.0f}"), "Présence", presence, shade),
            row("Son", shade + shown("sound", "{:.0%}").replace("%", " %") + RESET),
        ]
    elif seen.connected:
        lines.append(row("", f"{DIM}pas encore de mesure{RESET}"))

    if not online:
        alerts = f"{DIM}-{RESET}"
    elif seen.alerts:
        alerts = " · ".join(alert(kind, severity) for kind, severity in seen.alerts)
    else:
        alerts = f"{GREEN}aucune{RESET}"
    lines += [row("Alertes", alerts), ""]

    containers = system.get("containers")
    vision = (containers or {}).get("vision")
    if not system.get("webcam"):
        webcam = pill("NON BRANCHÉE", 41)
    elif vision == "ok":
        webcam = pill("EN MARCHE", 42)
    elif vision == "unhealthy":
        webcam = pill("SANS IMAGE", 41)
    elif vision == "starting":
        webcam = pill("DÉMARRE", 43)
    else:
        webcam = pill("VISION ARRÊTÉ", 41)
    lines.append(row("Webcam", webcam))

    if containers is None:
        services = pill("DOCKER ?", 43)
    elif not containers:
        services = pill("STACK ARRÊTÉE", 41)
    else:
        up = sum(state == "ok" for state in containers.values())
        # Stopped or failing their healthcheck, by name; starting ones are only not counted yet.
        wrong = sorted(name for name, state in containers.items() if state in ("down", "unhealthy"))
        colour = 41 if wrong else 42 if up == len(containers) else 43
        services = f"{pill(f'{up}/{len(containers)}', colour)}  " + (", ".join(wrong) if wrong else "en marche")
    lines.append(row("Services", services))
    return lines


def fit(line: str, width: int) -> str:
    """The line cut to `width` columns, its colours kept: a longer one would wrap and push the rest down."""
    out, seen, at = [], 0, 0
    while at < len(line) and seen < width:
        escape = ESCAPE.match(line, at)
        if escape:
            out.append(escape.group())
            at = escape.end()
        else:
            out.append(line[at])
            seen, at = seen + 1, at + 1
    return "".join(out) + RESET


def prepare_console() -> None:
    """Large letters, no cursor, never blanked: the screen is only ever looked at."""
    font = next((path for path in FONTS if path.exists()), None)
    if font is not None and sys.stdin.isatty():
        run("setfont", str(font))
    # Cursor hidden, screen blanking and power-down off, screen cleared.
    sys.stdout.write("\033[?25l\033[9;0]\033[14;0]\033[2J")
    sys.stdout.flush()


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit() or not 0 <= int(sys.argv[1]) <= 254:
        sys.exit("Usage: python3 infra/screen.py <table number>")
    table = int(sys.argv[1])
    pi_ip, sentinel_ip = f"192.168.{table}.1", f"192.168.{table}.10"
    ssid = printable(env_value(SECRETS / "wifi.env", "WIFI_SSID") or f"SentinelX-{table}", 32)

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    prepare_console()
    sentinel = Sentinel()
    client = listen(pi_ip, sentinel)
    system, polled = {}, -math.inf
    try:
        while not stop.is_set():
            now = time.monotonic()
            if now - polled >= POLL_S:
                system, polled = poll(sentinel_ip), now
            width, height = shutil.get_terminal_size((50, 15))
            lines = render(width, table, ssid, pi_ip, sentinel_ip, system, sentinel.snapshot(now))
            # From the top, each line over the last one: no flicker, and no newline after the last row,
            # which would scroll the screen.
            sys.stdout.write("\033[H" + "\033[K\n".join(fit(line, width) for line in lines[:height]) + "\033[K\033[J")
            sys.stdout.flush()
            stop.wait(1 - time.time() % 1)
    except KeyboardInterrupt:
        pass
    finally:
        if client is not None:
            client.loop_stop()
        sys.stdout.write(f"{RESET}\033[2J\033[H\033[?25h")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
