# firmware/ — Edge / IoT (the Sentinel)

**Node:** Sentinel · **MCU:** ESP32 · **Language:** C++ (PlatformIO)

Firmware for the Sentinel: reads the probes, drives the OLED and the Alarm, **decides its own local Alerts**, and streams secure telemetry to the Command Post (the Pi in the same Enclosure).

## Hardware (committed core)
- **MCU:** ESP32 (Wi-Fi 2.4 GHz to the Pi's access point) — ESP8266 deviation justified in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#deviations-to-validate-with-the-coach-monday)
- **Probes:** DHT22 (temp/humidity), MQ-2 (gas — 5 V heater; its analog output needs a divider to stay under 3.3 V), PIR HC-SR501 (presence), accelerometer (tamper), fingerprint (operator access)
- **Display:** OLED I2C 0.96" (Wi-Fi/IP, Status, active Alerts) — visible through the Enclosure
- **Alarm:** buzzer + speaker via MP3/audio amp (siren / spoken alert) + status LEDs

## Responsibilities
- Cadenced probe sampling → one **telemetry snapshot** per cycle, published over **MQTTS**.
- **Own its Alerts** (`gas`, `thermal`, `presence`, `tamper`) with threshold **hysteresis** — one Alert per transition, no flapping.
- **Fire the Alarm locally and immediately** on a critical condition — even if the Command Post is down (this is what makes the Sentinel *autonomous*).
- Subscribe to actuator commands (buzzer / speaker / LED) from the API.

## Security
- MQTTS on port 8883 only; **broker certificate verified against the team CA** (`setCACert`) — never `setInsecure()`.
- Own MQTT credentials (`sentinel-01`). The broker ACL only lets it publish `sentinel/sentinel-01/{telemetry,alert}` and read `command/sentinel-01/actuator`.

## Contract
Telemetry, Alert and command schemas + topics: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement). Lock Monday.

## TODO (Mon–Tue)
- [ ] Breadboard wiring diagram
- [ ] Probe read loop + calibration (MQ-2 warm-up!)
- [ ] Telemetry snapshot + Alert state machine (hysteresis)
- [ ] Autonomous Alarm path (buzzer/MP3 on critical, Pi-independent)
- [ ] MQTTS connection with team CA cert + MQTT credentials
- [ ] Actuator command handling

> Wi-Fi SSID/passphrase, broker IP, MQTT credentials and the CA cert go in `include/secrets.h` — **gitignored, never committed**. Ship `include/secrets.example.h`.
