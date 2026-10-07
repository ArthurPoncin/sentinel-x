# firmware/ — Edge / IoT (the Sentinel)

**Node:** Sentinel · **MCU:** ESP32 · **Language:** C++ (PlatformIO)

Firmware for the Sentinel: reads the probes, drives the Alarm, **decides its own local Alerts**, and streams secure telemetry to the Command Post (the Pi in the same Enclosure).

## Hardware (committed core)
- **MCU:** ESP32 DevKitC V4 by AZ-Delivery (ESP32-WROOM-32, 38 pins; Wi-Fi 2.4 GHz to the Pi's access point) — ESP8266 deviation justified in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#deviations-to-validate-with-the-coach-monday)
- **Probes:** DHT22 (temp/humidity), MQ-2 (gas — 5 V heater; its analog output needs a divider to stay under 3.3 V), PIR HC-SR501 (presence), CZN-15E sound sensor (digital output only: HIGH/LOW against the threshold set by its potentiometer; the firmware samples it fast and reports the share of the cycle that was loud). Analog probes go on ADC1 pins: ADC2 is unusable while Wi-Fi is on.
- **Display:** none on the ESP32. The status screen is the Pi's HDMI screen ([`../infra/README.md`](../infra/README.md#the-status-screen)): it shows whether the Sentinel is online, its readings and its raised Alerts. Why it is not online, the serial monitor says
- **Alarm:** DFPlayer Mini and a passive speaker (4–8 Ω, 3 W at most), on UART2 (IO16/IO17, 9600 baud). It plays the sounds of its own microSD card: [The microSD card](#the-microsd-card)

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
| `include/pins.h` | GPIOs, as on the wiring diagram |
| `include/config.h` | cycle, thresholds, hysteresis, warm-ups: **calibrate here** |
| `src/probes.*` | DHT22, MQ-2 (16-sample average), PIR, sound share (50 ms windows on an esp_timer, idle level read at boot) |
| `src/alerts.*` | one state machine per kind; a severity change is raised again on the same `alert_id` |
| `src/speaker.*` | the Alarm on the DFPlayer: siren while an Alert is critical; `on` (steady tone) / `pattern` (siren) / `off` from the Operator (`off` silences until the next critical). Resets the DFPlayer at boot, then sets its volume (`ALARM_VOLUME` in `include/config.h`) |
| `src/uplink.*` | Wi-Fi (hostname `sentinel-01`), time from the Pi, MQTTS with the team CA, commands |
| `src/main.cpp` | one cycle per second: read, decide, sound, publish, and a line on the serial monitor |

**What to expect:** a short beep from the speaker a second or two after boot, then the Pi's HDMI screen shows the Sentinel `EN LIGNE`. Until then, the serial monitor (`pio device monitor`) says what it waits for, a line a second: `T=… H=… air=… pir=… son=… | mp3=… wifi=… heure=… broker=… <problem>`, `mp3=1` once the DFPlayer said it reads its card, the problem being `Wi-Fi...` or `MQTT: …` (TLS/network, password) until the broker is reached. Telemetry starts once the DHT22 has answered and the Pi gave the time: the contract wants every reading and a real `ts`. The MQ-2 and the PIR raise no Alert during their first minute (warm-up). Alert transitions made while the broker is unreachable are queued (16), and every raised Alert is sent again on reconnection.

## The microSD card
The DFPlayer plays from its own microSD card (32 GB at most, FAT32), not from the ESP32. Copy the [`sd/mp3`](sd/mp3) folder to the root of the card:

| File | Sound | When |
|---|---|---|
| `mp3/0001.mp3` | siren, 1800 and 2600 Hz in turn, 350 ms each | an Alert is critical, or the Operator's `pattern` |
| `mp3/0002.mp3` | steady 2600 Hz | the Operator's `on` |
| `mp3/0003.mp3` | 150 ms beep | at boot: the speaker is wired |

Another sound works too, as an MP3 of the same name: the siren and the tone last 30 s, and the firmware plays them again from the start every 29.5 s, so a longer file is cut there and a shorter one leaves a silence. [`sd/sounds.py`](sd/sounds.py) made these (`pip install lameenc`). The serial monitor says `[speaker] DFPlayer error 6` when a file is missing, and `no word from the DFPlayer` when nothing comes back on IO16: the Alarm then plays anyway, blind.

## Contract
Telemetry, Alert and command schemas + topics: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#json-schemas-the-contract--lock-monday-change-only-by-team-agreement). Lock Monday.

## TODO
- [x] Breadboard wiring diagram
- [x] Probe read loop, telemetry snapshot, Alert state machine (hysteresis), autonomous Alarm
- [x] MQTTS connection with team CA cert + MQTT credentials, actuator commands
- [x] The Alarm on a DFPlayer Mini and its speaker, in place of the buzzer
- [ ] Calibrate the thresholds in `include/config.h` on the real kit (MQ-2 in clean air, a clap, a hand on the DHT22)
