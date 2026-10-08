# firmware/ — Edge / IoT (the Sentinel)

**Node:** Sentinel · **MCU:** ESP32 · **Language:** C++ (PlatformIO)

Firmware for the Sentinel: reads the probes, drives the Alarm, **decides its own local Alerts**, and streams secure telemetry to the Command Post (the Pi in the same Enclosure).

## Hardware (committed core)
- **MCU:** ESP32 DevKitC V4 by AZ-Delivery (ESP32-WROOM-32, 38 pins; Wi-Fi 2.4 GHz to the Pi's access point) — ESP8266 deviation justified in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#deviations-to-validate-with-the-coach-monday)
- **Probes:** DHT22 (temp/humidity), MQ-2 (gas — 5 V heater; its analog output needs a divider to stay under 3.3 V), PIR HC-SR501 (presence), CZN-15E sound sensor (digital output only: HIGH/LOW against the threshold set by its potentiometer; the firmware samples it fast and reports the share of the cycle that was loud). Analog probes go on ADC1 pins: ADC2 is unusable while Wi-Fi is on.
- **Display:** none on the ESP32. The status screen is the Pi's HDMI screen ([`../infra/README.md`](../infra/README.md#the-status-screen)): it shows whether the Sentinel is online, its readings and its raised Alerts. Why it is not online, the serial monitor says
- **Alarm:** a passive speaker (4–8 Ω) between IO25 and GND, through **100 Ω or more**: about 30 mA, what a pin may give. Or the buzzer, straight between IO25 and GND, louder for the same current. The firmware plays a square wave on it: the siren, a tune of 523 to 1397 Hz. **Never the speaker on 5V**: through IO25 it is a short circuit of the 5 V rail, which then fails everything on it, and the pin with it. Louder still through an NPN transistor (2N2222, BC547): IO25 → 1 kΩ → base, emitter → GND, collector → the speaker's black wire, its red wire → 47 Ω → 5 V

## Responsibilities
- Cadenced probe sampling → one **telemetry snapshot** per cycle, published over **MQTTS**.
- **Own its Alerts** (`gas`, `thermal`, `presence`, `noise`) with threshold **hysteresis** — one Alert per transition, no flapping.
- **Fire the Alarm locally and immediately** on a critical condition — even if the Command Post is down (this is what makes the Sentinel *autonomous*).
- Subscribe to actuator commands from the API. The contract's actuator is still called `buzzer`: it drives the speaker.

## Security
- MQTTS on port 8883 only; **broker certificate verified against the team CA** (`setCACert`) — never `setInsecure()`.
- Own MQTT credentials (`sentinel-01`). The broker ACL only lets it publish `sentinel/sentinel-01/{telemetry,alert}` and read `command/sentinel-01/actuator`.

## Build and flash
**Plug and play:** plug the ESP32 into a USB port of the Pi, then on the Pi run [`../infra/plug-and-play.sh`](../infra/plug-and-play.sh) `<table>`. It writes `include/secrets.h` from the Pi's own `infra/secrets/` (the credentials never leave the Command Post), builds the firmware and flashes it.

By hand, from a laptop with PlatformIO: copy `include/secrets.example.h` to `include/secrets.h` (git-ignored), fill it from `infra/secrets/handover.txt` and `infra/secrets/ca.crt`, then `pio run -t upload` and `pio device monitor`.

| File | Role |
|---|---|
| `include/pins.h` | GPIOs, as on the wiring diagram: [`../docs/cablage/esp32.html`](../docs/cablage/esp32.html), the Pi's in [`raspberry-pi.html`](../docs/cablage/raspberry-pi.html) |
| `include/config.h` | cycle, thresholds, hysteresis, warm-ups: **calibrate here** |
| `src/probes.*` | DHT22, MQ-2 (millivolts at IO34, 16-sample average, on the ADC's fine 0–1 V range below 0.9 V), PIR, sound share (sampled every ms on an esp_timer: a 50 ms window is loud past 2 ms of sound) |
| `src/alerts.*` | one state machine per kind; a severity change is raised again on the same `alert_id` |
| `src/speaker.*` | the Alarm: siren (the "Axel F" riff of Crazy Frog as a square wave, 523 to 1397 Hz, looping) while an Alert is critical; `on` (steady 2600 Hz) / `pattern` (siren) / `off` from the Operator (`off` silences until the next critical) |
| `src/uplink.*` | Wi-Fi (hostname `sentinel-01`), time from the Pi, MQTTS with the team CA, commands |
| `src/main.cpp` | one cycle per second: read, decide, sound, publish, and a line on the serial monitor |

**What to expect:** a short beep from the speaker at boot, then the Pi's HDMI screen shows the Sentinel `EN LIGNE`. Until then, the serial monitor (`pio device monitor`) says what it waits for, a line a second: `T=… H=… air=… pir=… son=… | wifi=… heure=… broker=… <problem>`, the problem being `Wi-Fi...` or `MQTT: …` (TLS/network, password) until the broker is reached. Telemetry starts once the DHT22 has answered and the Pi gave the time: the contract wants every reading and a real `ts`. The MQ-2 and the PIR raise no Alert during their first minute (warm-up). If the sound sensor already hears sound at boot, the serial monitor says so: its screw is set too sensitive. The settings of the three probes (screws, jumper, the MQ-2 test with a lighter) are under « Réglages » in [`../docs/cablage/esp32.html`](../docs/cablage/esp32.html). Alert transitions made while the broker is unreachable are queued (16), and every raised Alert is sent again on reconnection.

## Contract
Telemetry, Alert and command schemas + topics: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement). Lock Monday.

## TODO
- [x] Breadboard wiring diagram
- [x] Probe read loop, telemetry snapshot, Alert state machine (hysteresis), autonomous Alarm
- [x] MQTTS connection with team CA cert + MQTT credentials, actuator commands
- [x] The Alarm on a speaker, in place of the buzzer
- [ ] Calibrate the thresholds in `include/config.h` on the real kit (MQ-2 in clean air, a clap, a hand on the DHT22)
