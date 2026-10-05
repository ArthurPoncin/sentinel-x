# infra/ — Platform & Network

**Owner:** Infra 1

Orchestrates the whole server stack on the Local Server (laptop) and owns the isolated table network.

## Container stack (Docker-Compose)
Mosquitto (MQTT) · time-series DB · API · (AI) · dashboard · reverse-proxy (TLS) · monitoring.
Resilient & reproducible — `docker compose up` brings the whole outpost online.

## Network topology
- Dedicated Wi-Fi access point for our table.
- Isolated subnet **`192.168.X.0/24`** — full IP plan, masks, routing.
- ESP8266 traffic isolated toward the Local Server; no interference with neighboring teams.

## MCO monitoring
- Host CPU/RAM, container health.
- MQTT message/log volume under continuous load.

## TODO
- [ ] `docker-compose.yml` skeleton + service `.env.example`s
- [ ] Mosquitto config (TLS-ready, with Cyber)
- [ ] DB + volumes
- [ ] Wi-Fi AP + IP plan documented (diagram for the report)
- [ ] Monitoring (Prometheus/Grafana or cAdvisor)

> Deliverable: the **network schema** for the engineering report.
