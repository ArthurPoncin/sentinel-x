# cyber/ — Cybersecurity & MCO

**Owner:** Infra 2 · transversal (everyone secures their own brick)

## Secure the flows (mandatory)
- End-to-end encryption: **MQTT → MQTTS (TLS)** for the Sentinel↔Command Post link, **HTTPS** for the AI Worker → API and the dashboard.
- Team CA + certs for the Sentinel (ESP32) to broker link (coordinate with Infra & firmware).

## System hardening
- Harden the **Command Post (Pi)** — the main pentest target: close all non-required ports (UFW / iptables), SSH **keys only** (no passwords), strict Docker daemon privilege isolation.
- **AI Worker (laptop) hygiene** before Thursday's pentest: it is on the attack subnet, so use a dedicated `sentinel` account and, Wednesday night, close personal sessions (`gh auth logout`, clear the SSH agent, sign out of the browser).

## Offensive audit (Thursday — cross-team pentest)
- Authorized engagement against other tables in the workshop (and defending ours).
- Tooling: Nmap, Wireshark, Metasploit — MitM, payload injection, DoS against *consenting workshop targets only*.
- Produce the **security matrix** (hardening + TLS) and the **post-pentest audit report** for the engineering dossier.

## TODO
- [ ] TLS certs + MQTTS enforced
- [ ] Hardening checklist applied + documented
- [ ] Pentest plan & rules of engagement
- [ ] Audit report template

> ⚠️ Pentesting is scoped to the workshop's consenting teams only. No secrets or keys committed to git.
