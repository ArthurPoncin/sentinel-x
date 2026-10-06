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
5. flashes the ESP32 over USB and waits for its first telemetry snapshot on the broker.

Everything comes back by itself when the Pi reboots. The manual steps follow, for reference.

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
git pull && docker compose up -d --build        # update
```

**4. Open it** from the Operator laptop, on the table Wi-Fi: import `infra/secrets/ca.crt` as a trusted authority in the browser (or the OS), then `https://192.168.X.1/` and log in. From the Pi itself: `curl --cacert infra/secrets/ca.crt https://127.0.0.1/api/v1/auth/check` → `401` until logged in; `https://127.0.0.1/camera` too, the camera feed being for the Operator only.

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
- **The camera.** Docker refuses to create a container whose device node is missing on the host, so `vision`'s camera nodes are not in `docker-compose.yml` but in [`../docker-compose.camera.yml`](../docker-compose.camera.yml): the stack still starts on a laptop, or on the Pi with its ribbon loose — `vision` then says `camera down`, on `/health` and in the feed. They are the Pi 4's (libcamera: the camera's receiver and sensor, the ISP, their media controllers, the frame memory, the udev database read-only). `plug-and-play.sh` puts this line in `.env` when they all exist, and takes it out when one is missing:
  ```bash
  COMPOSE_FILE=docker-compose.yml:docker-compose.camera.yml    # every docker compose command takes both
  ```
  Nodes only, never `privileged`: the container sees those and nothing else of `/dev`, through the host's `video` group (`group_add`, GID 44 on Debian and Raspberry Pi OS; another one: `VIDEO_GID=$(getent group video | cut -d: -f3)` in `.env`).
- **Which detector.** `DETECTOR` defaults to `tflite`: EfficientDet-Lite0 sees a *person*, its model fetched into the image at build time (sha256 checked). `DETECTOR=motion` in `.env` falls back to OpenCV motion detection. Benchmark on the Pi, the service stopped: `docker compose run --rm --entrypoint python3 vision -m vision.bench` (ai/README.md).
- **Which camera.** `CAMERA_SOURCE` defaults to `picamera2`, the ZIF camera: OpenCV cannot read its raw node, Picamera2 (libcamera) can, and the image carries it when built on the Pi (arm64). `CAMERA_SOURCE=opencv:0` in `.env` takes a USB webcam instead (its node in a compose override). To replay a video instead: put `CAMERA_SOURCE=opencv:/path/in/the/container.mp4` in `.env` and mount the file in a compose override.
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
No local console on the Pi (the joystick is dropped). The brief lists MCO monitoring under the Cyber pillar: show `docker stats` (CPU/RAM), container health, the MQTT message rate and the log rotation in the engineering report.
