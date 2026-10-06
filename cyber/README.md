# cyber/ — Cybersecurity

**Owner:** Infra 2 · transversal (everyone secures their own brick)

The rules every workstream follows are in [`../docs/ARCHITECTURE.md` § Security model](../docs/ARCHITECTURE.md#security-model-binding-for-every-workstream). This folder owns the security material, the hardening of the Command Post and the pentest.

## Secure the flows (mandatory)
- End-to-end encryption: **MQTTS (TLS ≥ 1.2, port 8883)** between the Sentinel and the broker, **HTTPS/WSS** for the dashboard. No plaintext listener (no MQTT 1883, no HTTP 80).
- **Team CA** (OpenSSL) → broker + reverse-proxy certificates. Broker SAN = `IP:192.168.X.1` (the ESP32 connects by IP) + `DNS:mosquitto` (internal clients `api`, `predictive`). Every client verifies the broker against the CA.
- **Credentials:** one MQTT account per client (`sentinel-01`, `api`, `predictive`) + ACL, one API token per AI service, one Operator account. Generated here, handed over out of band, **never committed**.

## Harden the Command Post (Pi) — the pentest target
Applied by [`harden.sh`](harden.sh) (#49), once `infra/plug-and-play.sh` is done — see [below](#hardensh), and step by step in [`../docs/DURCISSEMENT-PI.md`](../docs/DURCISSEMENT-PI.md).
- **Accounts:** no default user/password; dedicated admin user.
- **SSH:** keys only (ed25519) — `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers <admin>`; reachable from the Operator laptop only.
- **Firewall:** UFW `default deny incoming`; allow 22/tcp from the laptop, 67/udp (DHCP) and 123/udp (NTP) on `wlan0`.
  ⚠️ **Docker bypasses UFW** for published ports. So: publish only `443` and `8883`, and filter them in the `DOCKER-USER` iptables chain with rules matching `-i wlan0` (table subnet only). Container-to-container traffic never enters on `wlan0`, so the AI services keep reaching the broker.
- **Services:** disable what we don't use (`bluetooth`, `avahi-daemon`, …).
- **Docker daemon privilege isolation:**
  - no `privileged: true`, never mount `/var/run/docker.sock`;
  - `cap_drop: [ALL]` (add back only what a service proves it needs), `security_opt: [no-new-privileges:true]`;
  - non-root `user:` in every container, `read_only: true` where possible;
  - `api`, `dashboard`, `vision`, `predictive` on the internal network only; the USB webcam reaches `vision` via `devices:` (its node only, in `docker-compose.camera.yml`) and the host's `video` group (`group_add`), never `privileged`.
- **Wi-Fi AP:** WPA2-PSK, CCMP/AES only, WPS off, long random passphrase (out of git). No NAT/bridge to another network.

### `harden.sh`
On the Pi, from the Operator laptop over SSH on the table Wi-Fi, as your usual user:

```bash
cyber/harden.sh 4 --dry-run   # what it would do, nothing changed
cyber/harden.sh 4             # table 4: the Pi is 192.168.4.1
cyber/harden.sh 4 --check     # nothing changed: the checklist, ✓ or ✗ line by line; exit 1 on a ✗
```

Run again, it ends in the same state. `--operator <ip>` names the Operator laptop (default: where the SSH session comes from), `--admin <user>` the one account SSH lets in (default: you).

- **SSH** — `/etc/ssh/sshd_config.d/00-sentinel-x.conf`: public key only, `ssh-ed25519` only, no root, `AllowUsers <admin>`. Done last, validated with `sshd -t` and against the effective configuration (`sshd -T`), then a reload: the open session stays.
- **Firewall** — UFW reset to: deny incoming, allow outgoing, and three rules on `wlan0`: 22/tcp from the Operator laptop, 67/udp, 123/udp. The laptop keeps its address through a DHCP reservation (`/etc/dnsmasq.d/sentinel-x-operator.conf`).
- **Docker's published ports** — a `SENTINEL-X` chain called first from `DOCKER-USER`: a packet for a container passes when it answers a connection already let in, when it comes from the table's subnet on `wlan0` for 443 or 8883 **of the Pi** (matched on the connection's original destination: the proxy listens on 8443 in its container), or when it comes from a container. Anything else entering the Pi for a container is dropped, whatever the interface: Ethernet too. `sentinel-x-docker-filter.service` puts it back at boot, before Docker starts.
- **Services** — `bluetooth`, `hciuart`, `avahi-daemon`, `triggerhappy`, `ModemManager` disabled where installed. Without avahi, `sentinel-x.local` no longer answers: the Pi is `192.168.X.1`.
- **Nobody locked out** — it stops before changing anything if the admin has no ed25519 key on the Pi, if the SSH session it runs in logged in with a password, or if the Operator laptop is not on the table Wi-Fi.
- **Only looked at**, as they are set up elsewhere: the default `pi` account, the table Wi-Fi's security (`infra/plug-and-play.sh`), privileged containers or the Docker socket (`docker-compose.yml`).

Tested off the Pi, in a Debian 12 container with its real sshd, UFW and iptables, on a simulated table network: who reaches what, before and after, with real connections. **Not tested on the Pi yet**: systemd (the services, the unit at boot), the real Docker, Raspberry Pi OS itself — the reboot and the Nmap scan of `DURCISSEMENT-PI.md` are that test.

## Operator laptop
Client only: OS firewall on, no service exposed on the table network, no personal session needed for the demo.

## Offensive audit (Thursday — cross-team pentest)
- Authorized engagement against other tables in the workshop (and defending ours).
- Tooling: Nmap, Wireshark, Metasploit — MitM, payload injection, DoS against *consenting workshop targets only*.
- Produce the **security matrix** (hardening + TLS) and the **post-pentest audit report** for the engineering dossier.

## TODO
- [ ] Team CA + certs, MQTTS enforced (no 1883)
- [ ] MQTT password file + ACL, API tokens, Operator account
- [x] Pi hardening script and its step-by-step (`harden.sh`, `docs/DURCISSEMENT-PI.md`) — #49
- [ ] Pi hardening applied on the Pi, checklist + Nmap output in the security matrix — #49
- [ ] Docker hardening reviewed on every service
- [ ] Pentest plan & rules of engagement
- [ ] Audit report template

> ⚠️ Pentesting is scoped to the workshop's consenting teams only. No secrets or keys committed to git.
