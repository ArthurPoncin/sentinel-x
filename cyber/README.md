# cyber/ — Cybersecurity & MCO

**Owner:** Infra 2 · transversal (everyone secures their own brick)

## Secure the flows (mandatory)
- End-to-end encryption: **MQTT → MQTTS (TLS)**, HTTPS for the dashboard/API.
- Team CA + certs for the ESP8266 ↔ broker link (coordinate with Infra 1 & Dev 1).

## System hardening
- Close all non-required ports (UFW / iptables).
- SSH: **asymmetric keys only**, no password auth.
- Strict Docker daemon privilege isolation.

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
