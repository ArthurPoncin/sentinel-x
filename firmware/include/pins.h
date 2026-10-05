#pragma once

// Sentinel wiring on the ESP32 DevKitC V4 (AZ-Delivery): GPIO numbers, as on the wiring diagram.

constexpr int PIN_MQ2_AO = 34;  // MQ-2 analog output, through the 10k/20k divider (ADC1)
constexpr int PIN_SOUND = 26;   // CZN-15E digital output
constexpr int PIN_PIR = 27;     // HC-SR501 output, already 3.3 V
constexpr int PIN_DHT = 4;      // DHT22 data, 10k pull-up to 3V3
constexpr int PIN_BUZZER = 25;

// ST7735S 1.8" LCD on the hardware SPI bus (VSPI: SCK 18, MOSI 23).
constexpr int PIN_TFT_CS = 5;
constexpr int PIN_TFT_DC = 21;
constexpr int PIN_TFT_RST = 22;
