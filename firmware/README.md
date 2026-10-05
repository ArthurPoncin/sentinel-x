# firmware/ — Edge / IoT (ESP8266)

**Owner:** Dev 1 · **Language:** C++ (PlatformIO)

ESP8266 firmware for the Sentinel-X box: reads the environmental sensors, drives the local status display and alert actuators, and streams secure telemetry to the Local Server.

## Hardware
- **MCU:** ESP8266
- **Sensors:** DHT22 (temp/humidity), MQ-2 (gas/smoke), PIR HC-SR501 (presence)
- **Interfaces/alerts:** OLED I2C 0.96" (status), buzzer(s), status LEDs

## Responsibilities
- Cadenced sensor sampling → structured JSON payloads.
- Publish telemetry over **MQTTS (TLS)** to the broker.
- Subscribe to actuator commands (buzzer / LED) from the API.
- Show live status (Wi-Fi, IP, alert state) on the OLED.

## TODO (Mon–Tue)
- [ ] Wiring diagram on breadboard
- [ ] Sensor read loop + calibration (MQ-2 warm-up!)
- [ ] Payload schema aligned with `backend/` contract
- [ ] MQTTS connection with team CA cert
- [ ] Actuator command handling

> Config (Wi-Fi SSID, broker IP, cert paths) goes in `secrets.h` / `.env` — **never committed**. Provide a `secrets.example.h`.
