# infra/ — Platform & Network

**Node:** Command Post (Raspberry Pi 4, inside the Enclosure)

Orchestrates the whole server stack on the Pi and owns the isolated table network.

## Plug and play
Step by step, from a blank SD card to the dashboard: [`../docs/INSTALLATION-PI.md`](../docs/INSTALLATION-PI.md).

On a Raspberry Pi 4 with a recent Raspberry Pi OS (64-bit), plugged into Ethernet the first time, with the ESP32 on one of its USB ports:

```bash
git clone https://github.com/ArthurPoncin/sentinel-x.git && cd sentinel-x
infra/plug-and-play.sh X          # X = table number: the Pi becomes 192.168.X.1
```

[`plug-and-play.sh`](plug-and-play.sh) does everything below and more, and can be run again at will (it keeps what exists, `--no-flash` leaves the ESP32 alone):
1. installs Docker, dnsmasq, chrony and PlatformIO, while there is Internet;
2. makes the secrets ([`setup.sh`](setup.sh)) and starts the stack;
3. builds the Sentinel's firmware with this Pi's secrets: no `handover.txt` to carry for the ESP32;
4. turns the Pi's Wi-Fi into the table access point `SentinelX-X` (NetworkManager, 2.4 GHz, WPA2/CCMP, passphrase made once in `infra/secrets/wifi.env`), with DHCP only (dnsmasq: no DNS, no gateway, `sentinel-01` always on `.10`) and the time for the table (chrony: the network has no Internet, and every reading is time-stamped);
5. shows the Command Post's status on the Pi's HDMI screen ([below](#the-status-screen));
6. flashes the ESP32 over USB and waits for its first telemetry snapshot on the broker.

Its images come ready-made: [`.github/workflows/images.yml`](../.github/workflows/images.yml) builds each one for the Pi (linux/arm64, on GitHub's own Arm runners) on every push to `main` and publishes it on GHCR as `ghcr.io/arthurponcin/sentinel-x-<service>:<key>`, the key being that of the code it is built from ([`images.sh`](images.sh): the git trees of its paths, so the same code gives the same key on the CI as on the Pi). `plug-and-play.sh` pulls, all at once, the image whose key matches its checkout and names it as `docker-compose.yml` does; it builds on the Pi only what it cannot pull — code changed on the Pi, a key the CI has not published yet, a package still private — and, offline, keeps the images it has. The packages are private when first published: their owner makes each one public once (*Package settings → Change visibility → Public*). A new path in a Dockerfile's `COPY` goes into its service's paths in `images.sh`, or a stale image could be pulled.

It talks French, through [`ui.sh`](ui.sh): sudo and the Operator password asked first, then 10 numbered steps with a spinner and their time, the commands' output in `~/.local/share/sentinel-x/plug-and-play.log` (its last line shown under the running step), a framed reason and the failed command's last lines when a step fails, a framed summary at the end. Plain lines, without the animation, when its output is not a terminal; `NO_COLOR` turns the colours off.

Everything comes back by itself when the Pi reboots. The manual steps follow, for reference.

Once installed, an update is [`update.sh`](update.sh), with Ethernet plugged in: `git pull`, the images of the new code (pulled or built as above, through [`pull.sh`](pull.sh), which both scripts share), then `docker compose up -d`, which makes again only the containers whose image or settings changed, and a restart of the broker when `mosquitto.conf` changed. No sudo, no table number: the Wi-Fi, the secrets, the status screen and the ESP32 stay as they are, so an SSH session over the table Wi-Fi holds and the hardening stays in place. It does not apply a new firmware, a new broker account or ACL, nor a change to the Pi's own setup or to its hardening: when the pull brought one, it says so at the end, with the command to run (`plug-and-play.sh`, `harden.sh`).

Before the pentest, [`../cyber/harden.sh`](../cyber/harden.sh) closes the Pi down to what the table needs (SSH by key from the Operator laptop only, UFW, Docker's published ports kept to the table Wi-Fi) — [`../cyber/README.md`](../cyber/README.md#hardensh). Run it again after each `plug-and-play.sh`.

## Run the Command Post on the Pi
Everything runs from [`../docker-compose.yml`](../docker-compose.yml). The secrets it needs are made once, on the Pi, by [`setup.sh`](setup.sh), into `infra/secrets/` (git-ignored, never committed).

**1. Prepare the Pi** — while it still has Internet, through Ethernet:

```bash
curl -fsSL https://get.docker.com | sh          # Docker Engine + the compose plugin
sudo usermod -aG docker "$USER" && newgrp docker
git clone https://github.com/ArthurPoncin/sentinel-x.git && cd sentinel-x
```

The repo is public: no SSH key needed to clone or `git pull`. Code changes go through PRs from the laptops; the Pi only pulls.

**2. Make the secrets**, once — `X` is the table number, the Pi is `192.168.X.1`:

```bash
infra/setup.sh X
```

- It asks for the Operator's password (12 characters or more) and makes the team CA, the broker and proxy certificates, one MQTT account per client (`sentinel-01`, `api`, `predictive`), the AI services' tokens and the Operator's password hash.
- Each service gets its own file, read by Compose on the Pi (`env_file`, mode 600): `api.env` (its MQTT password, the Operator's hash, both AI tokens), `vision.env` (`VISION_TOKEN`), `predictive.env` (the `predictive` MQTT password, `PREDICTIVE_TOKEN`) — the same values on both sides, so the api takes the AI services' Alerts and the broker their login.
- What exists is kept: run it again after a `git pull` to pick up a new ACL. An install made before `vision.env` and `predictive.env` gets them on the next run, from `api.env` and `handover.txt`, nothing else made again; only if `handover.txt` no longer holds the `predictive` password is a new one made, in place of the old one in the broker's `passwd`: then `docker compose restart mosquitto`, as the script says. To start over: `sudo rm -rf infra/secrets` (some files belong to the containers' users).
- The proxy certificate is for `192.168.X.1` and for `sentinel-x.local`. The table Wi-Fi has no DNS, and avahi is off once the Pi is hardened: the Operator laptop gets the name from its hosts file (`192.168.X.1 sentinel-x.local`), written by [`operator.sh`](operator.sh). A certificate made before the name is made again by `infra/plug-and-play.sh`, by the same CA.
- `EXTRA_SAN=IP:<ethernet ip> infra/setup.sh X` also puts the Pi's Ethernet address in the HTTPS certificate, to test from the school network.
- **`infra/secrets/handover.txt`** holds what the other teams need: the ESP32's MQTT password, the AI services' tokens. Hand it over out of band (USB key, in person), never in a chat or in git. The firmware also needs `infra/secrets/ca.crt` to verify the broker.

**3. Start the stack:**

```bash
docker compose up -d --build                    # first build: a few minutes on the Pi
docker compose ps                               # api turns (healthy) once it reaches the broker
docker compose logs -f api                      # follow one service
docker compose logs -f vision predictive        # the AI services
MOCK_FEED=true docker compose up -d api         # the scripted scenario, until the Sentinel is there
docker compose up -d api                        # back to the real feed
infra/update.sh                                 # update: git pull, the new images, the containers that changed
```

**4. Open it** from the Operator laptop, on the table Wi-Fi and from its clone of the repo: `infra/operator.sh X <your user on the Pi>` ([`operator.sh`](operator.sh), Linux and macOS; [`operator.ps1`](operator.ps1) on Windows, as administrator) fetches `infra/secrets/ca.crt` over scp, trusts it (the system's store, and Chrome's and Firefox's own lists on Linux) and writes `192.168.X.1 sentinel-x.local` in the hosts file. Then `https://sentinel-x.local/` (or `https://192.168.X.1/`) and log in. From the Pi itself: `curl --cacert infra/secrets/ca.crt https://127.0.0.1/api/v1/auth/check` → `401` until logged in; `https://127.0.0.1/camera` too, the camera feed being for the Operator only.

| Service | Image | Reached at | Runs as |
|---|---|---|---|
| `reverse-proxy` | Caddy ([`caddy/`](caddy/)) | **443** (HTTPS/WSS) → `/api/*` and `/ws` to `api`, `/camera` to `vision` (Operator session checked first), the rest to `dashboard` | `65534`, port 8443 inside |
| `mosquitto` | `eclipse-mosquitto:2.0` ([`mosquitto/`](mosquitto/)) | **8883** (MQTTS) — ESP32 by IP, `api`/`predictive` as `mosquitto:8883` | `1883` |
| `api` | [`../backend/`](../backend/) | `api:8080`, internal only | `node` |
| `dashboard` | [`../dashboard/`](../dashboard/) (static, Caddy) | `dashboard:8080`, internal only | `65534` |
| `vision` | [`../ai/vision/`](../ai/vision/) (Debian's Python 3.11 and OpenCV) | `vision:8000`, internal only; the proxy serves it as `/camera` | `10002`, + the host's `video` group |
| `predictive` | [`../ai/predictive/`](../ai/predictive/) | nothing to reach: it reads the broker, posts to `api` | `10001` |

- Every service: non-root, read-only filesystem, every capability dropped, `no-new-privileges`, log rotation. The `internal` network has no route out; only the proxy and the broker are also on `edge`, where the two published ports are.
- The history (SQLite) lives on the `api-data` volume: it survives `docker compose down`, not `down -v`. There is no `db` container: the history is the api's SQLite file, mounted read-only into `predictive` for its training. The trained model lives on the `predictive-model` volume, likewise.

### The AI services
- **The camera** is a USB webcam. Docker refuses to create a container whose device node is missing on the host, so `vision`'s webcam node is not in `docker-compose.yml` but in [`../docker-compose.camera.yml`](../docker-compose.camera.yml): the stack still starts on a laptop, or on the Pi with the webcam unplugged — `vision` then says `camera down`, on `/health` and in the feed. `plug-and-play.sh` finds the webcam by its name in `/dev/v4l/by-id` (only USB devices have one: any port, never one of the Pi's own video nodes), puts these lines in `.env` when it is there, and takes them out when it is not:
  ```bash
  COMPOSE_FILE=docker-compose.yml:docker-compose.camera.yml    # every docker compose command takes both (and docker-compose.pan.yml with the servo, below)
  CAMERA_DEVICE=/dev/v4l/by-id/usb-<the webcam>-video-index0  # /dev/video0 in the container
  ```
  The node only, never `privileged`: the container sees it and nothing else of `/dev`, through the host's `video` group (`group_add`, GID 44 on Debian and Raspberry Pi OS; another one: `VIDEO_GID=$(getent group video | cut -d: -f3)` in `.env`). Another webcam, or the same one plugged in after the stack started: run `plug-and-play.sh <table> --no-flash` again.
- **Which detector.** `DETECTOR` defaults to `tflite`: EfficientDet-Lite0 sees a *person*, its model fetched into the image at build time (sha256 checked). `DETECTOR=motion` in `.env` falls back to OpenCV motion detection. Benchmark on the Pi, the service stopped: `docker compose run --rm --entrypoint python3 vision -m vision.bench` (ai/README.md).
- **The servo** that turns the webcam is optional, and set up apart: [`servo.sh`](servo.sh), once, on the Pi with the servo wired — its signal on **GPIO 18** (pin 12), its ground on the Pi's (pin 14), its **5 V on a supply of its own** with the grounds joined (a servo that stalls draws more than the Pi's 5 V pin gives, and the Pi restarts). It turns the Pi's hardware PWM on for that pin (`dtoverlay=pwm,pin=18,func=2` in `/boot/firmware/config.txt`, one reboot) and installs `sentinel-x-servo.service`, which exports the PWM channel at each boot, before Docker, and gives its `period`, `duty_cycle` and `enable` files to the `gpio` group. `plug-and-play.sh` then finds the channel and adds [`../docker-compose.pan.yml`](../docker-compose.pan.yml) to `COMPOSE_FILE`, with these lines in `.env`:
  ```
  PAN_PWM_CHANNEL=/sys/devices/platform/soc/fe20c000.pwm/pwm/pwmchip0/pwm0   # /pwm in the container
  PAN_GID=<the gpio group>
  ```
  The channel's own directory only, never `privileged` and no capability: the container writes the width of the pulse, the kernel sends it. The file sets `PAN_DRIVE=pwm`: `vision` turns the camera to the person it follows and says how far in each `intrusion` Alert ([`../ai/`](../ai/README.md#the-camera-on-its-servo--pan_drivepwm)). The servo as it is mounted goes in `.env` too, when it differs from the defaults: `PAN_MIN_DEG`, `PAN_MAX_DEG` (its travel either way of where the camera rests), `PAN_MIN_US`, `PAN_MAX_US` (the pulse at each end), `PAN_INVERT`, `PAN_SPEED_DEG_S`, and `CAMERA_FOV_DEG` for the webcam's field of view; then `docker compose up -d vision`. `docker compose exec vision python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read())"` gives `pan`, in degrees. It needs the person detector: with `DETECTOR=motion`, `vision` refuses to start and says so. **Not yet run on the Pi** when this was written: if the container cannot write the channel (`Servo on /pwm unavailable` in `docker compose logs vision`), check the group of the three files (`ls -l /sys/class/pwm/pwmchip0/pwm0/`) against `PAN_GID`.
- **Which camera.** `CAMERA_SOURCE` defaults to `opencv:0`, the webcam that `docker-compose.camera.yml` puts at `/dev/video0` in the container. To replay a video instead: put `CAMERA_SOURCE=opencv:/path/in/the/container.mp4` in `.env` and mount the file in a compose override. The image still carries Picamera2 (`CAMERA_SOURCE=picamera2`), but the stack no longer gives it the ZIF camera's nodes: the team's ZIF camera was detected by the Pi and never sent a frame (`Camera frontend has timed out`).
- **The feed.** The proxy asks the api first (`forward_auth` on `GET /api/v1/auth/check`): without the Operator's session, `401`; with it, `/camera` goes to `vision` with the prefix stripped, query kept (`/camera?attempt=1` → `/?attempt=1`), each picture passed on as it comes (`flush_interval -1`).
- **Training the predictive model**, on a range of the history recorded with `MOCK_FEED` off, the api running (a read-only reader of its WAL-mode SQLite file needs the `-shm` file only the api keeps) — the procedure is in [`../ai/README.md`](../ai/README.md#capture--training--tuesday):
  ```bash
  docker compose run --rm predictive train --from 2026-10-13T08:00:00Z --to 2026-10-13T11:00:00Z
  ```
  It reads `api-data` mounted `:ro` at `/history` (the api writes it as `node`, files `0644`: readable by `predictive`'s uid 10001, writable by the api only) and writes `/model/model.joblib` on `predictive-model`; the running `predictive` takes the new model up by itself, no restart.

## Container stack (Docker-Compose, on the Pi)
`reverse-proxy` · `mosquitto` · `api` · `dashboard` · `vision` · `predictive` (the history: SQLite on the `api-data` volume) — roles in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#container-stack-docker-compose-on-the-pi).
Resilient & reproducible — `docker compose up` brings the Command Post online.

- **Only `reverse-proxy` (443) and `mosquitto` (8883) publish ports.** Everything else talks over the internal Compose network.
- Every service gets the shared hardening + log-rotation block (rotation keeps a message flood from filling the SD card):

```yaml
x-hardened: &hardened
  restart: unless-stopped
  security_opt: ["no-new-privileges:true"]
  cap_drop: [ALL]
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }
```

- Mosquitto listens on **8883 only** (TLS), no anonymous access. The explicit `listener` binds every interface of the container (Mosquitto 2.x is localhost-only without one): the ESP32 reaches it through the published port, `api` and `predictive` as `mosquitto:8883` on the Compose network. ACL content in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#security-model-binding-for-every-workstream):

```conf
# all interfaces: table Wi-Fi (published port) + Compose network (mosquitto:8883)
listener 8883
cafile   /mosquitto/config/certs/ca.crt
certfile /mosquitto/config/certs/broker.crt
keyfile  /mosquitto/config/certs/broker.key
tls_version tlsv1.2
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file      /mosquitto/config/acl
max_packet_size 4096
```

## The status screen
The Pi's HDMI screen (800×480, either micro-HDMI port) shows what the brief's OLED showed on the Sentinel, and more: the table Wi-Fi and whether its access point is up, the dashboard's address, the Sentinel (`EN LIGNE`, `SUR LE WI-FI`, `MUET`, `ABSENT`), its last readings and raised Alerts, the webcam and the containers. Redrawn every second by [`screen.py`](screen.py), the Pi OS's Python and `python3-paho-mqtt`, on the console in large Terminus letters, without a desktop.
- **Where it reads:** the broker, with its own MQTT account `screen` (made by `setup.sh`, in `infra/secrets/screen.env`), which may only read `sentinel/+/telemetry` and `sentinel/+/alert`; the DHCP leases, NetworkManager and `docker ps` with the user's own rights. The `intrusion` and `predictive` Alerts go to the api, not to the broker: they are on the dashboard only. Text from the network is stripped of control characters before it reaches the console.
- **How it runs:** the `sentinel-x-screen` systemd unit, as the user, on `tty1` in place of its login prompt (`getty@tty1` disabled; ctrl+alt+F2 gives one); its errors in `journalctl -u sentinel-x-screen`.
- **A black screen:** `video=HDMI-A-2:800x480M@60D` at the end of `/boot/firmware/cmdline.txt` forces the second port on, at 800×480.

## Network topology
- The **Pi is the Wi-Fi access point** (hostapd, WPA2-PSK CCMP) with DHCP reservations (dnsmasq) for **`192.168.X.0/24`** — IP plan in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#network-topology).
- The **Sentinel (ESP32)** and the **Operator laptop** join that Wi-Fi.
- No route/NAT to other networks; the Pi's Ethernet is for setup only — **pull Docker images and Python packages before going isolated**.
- No interference with neighboring tables (own SSID, own channel if possible).

## TODO
- [x] `docker-compose.yml` + `setup.sh` (secrets) — `reverse-proxy`, `mosquitto`, `api`, `dashboard`, `vision`, `predictive`
- [x] Mosquitto config (TLS + ACL, with Cyber)
- [ ] DB + volumes (history on the `api-data` volume for now; separate `db` to decide)
- [x] Wi-Fi AP + DHCP + time server: `plug-and-play.sh`
- [ ] IP plan / network schema for the report
- [ ] Pre-pull images, test a full cold boot offline

> Deliverable: the **network schema** for the engineering report.

## MCO monitoring
On the Pi itself, the HDMI status screen shows the containers' state ([above](#the-status-screen)). The brief lists MCO monitoring under the Cyber pillar: show `docker stats` (CPU/RAM), container health, the MQTT message rate and the log rotation in the engineering report.
