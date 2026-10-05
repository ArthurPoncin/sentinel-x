# infra/ — Platform & Network

**Node:** Command Post (Raspberry Pi 5, inside the Enclosure)

Orchestrates the whole server stack on the Pi and owns the isolated table network.

## Container stack (Docker-Compose, on the Pi)
`reverse-proxy` · `mosquitto` · `api` · `db` · `dashboard` · `vision` · `predictive` — roles in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#container-stack-docker-compose-on-the-pi).
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
- [ ] `docker-compose.yml` skeleton + per-service `.env.example`
- [ ] Mosquitto config (TLS + ACL, with Cyber)
- [ ] DB + volumes
- [ ] Wi-Fi AP + DHCP reservations + IP plan documented (network schema for the report)
- [ ] Pre-pull images, test a full cold boot offline

> Deliverable: the **network schema** for the engineering report.

## Bonus — local MCO console
Only if time allows: an **LCD + joystick wired directly to the Pi's GPIO**, showing CPU/RAM/temperature, container health and MQTT message rate / log volume, the joystick cycling screens.
- The Pi has **no analog input**: an analog joystick needs an ADC (ADS1115 over I2C, or MCP3008 over SPI) — or use a digital (switch) joystick.
- The brief lists MCO monitoring under the Cyber pillar: if this bonus is dropped, at least show `docker stats` and the log rotation in the engineering report.
