# cyber/ — Cybersecurity

**Owner:** Infra 2 · transversal (everyone secures their own brick)

The rules every workstream follows are in [`../docs/ARCHITECTURE.md` § Security model](../docs/ARCHITECTURE.md#security-model-binding-for-every-workstream). This folder owns the security material, the hardening of the Command Post and the pentest.

## Secure the flows (mandatory)
- End-to-end encryption: **MQTTS (TLS ≥ 1.2, port 8883)** between the Sentinel and the broker, **HTTPS/WSS** for the dashboard. No plaintext listener (no MQTT 1883, no HTTP 80).
- **Team CA** (OpenSSL) → broker + reverse-proxy certificates. Broker SAN = `IP:192.168.X.1` (the ESP32 connects by IP) + `DNS:mosquitto` (internal clients `api`, `predictive`). Every client verifies the broker against the CA.
- **Credentials:** one MQTT account per client (`sentinel-01`, `api`, `predictive`) + ACL, one API token per AI service, one Operator account. Generated here, handed over out of band, **never committed**.

## Harden the Command Post (Pi) — the pentest target
- **Accounts:** no default user/password; dedicated admin user.
- **SSH:** keys only (ed25519) — `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers <admin>`; reachable from the Operator laptop only.
- **Firewall:** UFW `default deny incoming`; allow 22/tcp from the laptop and 67/udp (DHCP) on `wlan0`.
  ⚠️ **Docker bypasses UFW** for published ports. So: publish only `443` and `8883`, and filter them in the `DOCKER-USER` iptables chain with rules matching `-i wlan0` (table subnet only). Container-to-container traffic never enters on `wlan0`, so the AI services keep reaching the broker.
- **Services:** disable what we don't use (`bluetooth`, `avahi-daemon`, …).
- **Docker daemon privilege isolation:**
  - no `privileged: true`, never mount `/var/run/docker.sock`;
  - `cap_drop: [ALL]` (add back only what a service proves it needs), `security_opt: [no-new-privileges:true]`;
  - non-root `user:` in every container, `read_only: true` where possible;
  - `db`, `api`, `dashboard`, `vision`, `predictive` on the internal network only; the webcam reaches `vision` via `devices:`.
- **Wi-Fi AP:** WPA2-PSK, CCMP/AES only, WPS off, long random passphrase (out of git). No NAT/bridge to another network.

## Operator laptop
Client only: OS firewall on, no service exposed on the table network, no personal session needed for the demo.

## Offensive audit (Thursday — cross-team pentest)
- Authorized engagement against other tables in the workshop (and defending ours).
- Tooling: Nmap, Wireshark, Metasploit — MitM, payload injection, DoS against *consenting workshop targets only*.
- Produce the **security matrix** (hardening + TLS) and the **post-pentest audit report** for the engineering dossier.

## TODO
- [ ] Team CA + certs, MQTTS enforced (no 1883)
- [ ] MQTT password file + ACL, API tokens, Operator account
- [ ] Pi hardening checklist applied + documented (UFW + `DOCKER-USER`, SSH, services)
- [ ] Docker hardening reviewed on every service
- [ ] Pentest plan & rules of engagement
- [ ] Audit report template

> ⚠️ Pentesting is scoped to the workshop's consenting teams only. No secrets or keys committed to git.
