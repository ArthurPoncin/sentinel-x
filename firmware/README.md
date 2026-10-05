# firmware/ — Edge / IoT (the Sentinel)

**Node:** Sentinel · **MCU:** ESP32 · **Language:** C++ (PlatformIO)

Firmware for the Sentinel field box: reads the probes, drives the local display and the Alarm, **decides its own local Alerts**, and streams secure telemetry to the Command Post.

## Hardware (committed core)
- **MCU:** ESP32 (Wi-Fi 2.4 GHz to the Pi's access point)
- **Probes:** DHT (temp/humidity), air (gas), PIR (presence), accelerometer (tamper), fingerprint (operator access)
- **Display:** local LCD (status: Wi-Fi/IP, Status, active Alerts)
- **Alarm:** buzzer + speaker via MP3/audio amp (siren / spoken alert) + status LEDs
- **Input:** joystick (local operator console — parked unless time allows)

## Responsibilities
- Cadenced probe sampling → one **telemetry snapshot** per cycle, published over **MQTTS**.
- **Own its Alerts** (`gas`, `thermal`, `presence`, `tamper`) with threshold **hysteresis** — one Alert per transition, no flapping.
- **Fire the Alarm locally and immediately** on a critical condition — even if the Command Post is down (this is what makes the box *autonomous*).
- Subscribe to actuator commands (buzzer / speaker / LED) from the API.

## Contract
Telemetry, Alert and command schemas + topics: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement). Lock Monday.

## TODO (Mon–Tue)
- [ ] Breadboard wiring diagram
- [ ] Probe read loop + calibration (air sensor warm-up!)
- [ ] Telemetry snapshot + Alert state machine (hysteresis)
- [ ] Autonomous Alarm path (buzzer/MP3 on critical, Pi-independent)
- [ ] MQTTS connection with team CA cert
- [ ] Actuator command handling

> Wi-Fi SSID, broker IP, cert paths go in `secrets.h` / `.env` — **never committed**. Ship a `secrets.example.h`.
