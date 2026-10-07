#pragma once

// Sentinel wiring on the ESP32 DevKitC V4 (AZ-Delivery): GPIO numbers, as on the wiring diagram.

constexpr int PIN_MQ2_AO = 34;  // MQ-2 analog output, through the 10k/20k divider (ADC1)
constexpr int PIN_SOUND = 26;   // CZN-15E digital output
constexpr int PIN_PIR = 27;     // HC-SR501 output, already 3.3 V
constexpr int PIN_DHT = 4;      // DHT22 data, 10k pull-up to 3V3
constexpr int PIN_MP3_RX = 16;  // UART2 RX, from the DFPlayer Mini's TX
constexpr int PIN_MP3_TX = 17;  // UART2 TX, to the DFPlayer Mini's RX through 1k
