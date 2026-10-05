# infra/ — Platform & Network

**Node:** Command Post (Raspberry Pi 4)

Orchestrates the server stack on the Pi and owns the isolated 3-node table network.

## Container stack (Docker-Compose, on the Pi)
Mosquitto (MQTT) · time-series DB · API · dashboard · reverse-proxy (TLS) · monitoring.
Resilient & reproducible — `docker compose up` brings the Command Post online.
(Vision + predictive AI run on the **AI Worker laptop**, not in containers — the Pi 4 can't do real-time inference.)

## Network topology (3 nodes)
- The **Pi is the Wi-Fi access point** for an isolated subnet **`192.168.X.0/24`**.
- The **Sentinel (ESP32)** joins that Wi-Fi (2.4 GHz).
- The **AI Worker (laptop)** links to the Pi over **wired Ethernet** — carries the camera stream + HTTPS, keeps video latency low, isolates it from Wi-Fi telemetry.
- Full IP plan, masks, routing; no interference with neighboring teams' tables.

## MCO monitoring
- Pi CPU/RAM, container health (genuinely meaningful — the Pi is resource-constrained).
- MQTT message/log volume under continuous load.

## TODO
- [ ] `docker-compose.yml` skeleton + per-service `.env.example`
- [ ] Mosquitto config (TLS-ready, with Cyber)
- [ ] DB + volumes
- [ ] Wi-Fi AP + Ethernet link + IP plan documented (diagram for the report)
- [ ] Monitoring (Prometheus/Grafana or cAdvisor)

> Deliverable: the **network schema** for the engineering report.
