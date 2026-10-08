#pragma once

#include <stdint.h>

// The broker's ACL only lets sentinel-01 publish on sentinel/sentinel-01/{telemetry,alert}.
constexpr const char *SENTINEL_ID = "sentinel-01";

constexpr uint32_t CYCLE_MS = 1000;        // one telemetry snapshot per cycle
constexpr uint32_t SOUND_WINDOW_MS = 50;   // `sound` = share of the cycle's 50 ms windows that were loud
constexpr uint32_t SOUND_MIN_MS = 2;       // a window is loud once the sensor heard sound for 2 of its ms
// The CZN-15E pulls its output LOW, and lights its LED, while it hears sound. A module that does
// the opposite: false.
constexpr bool SOUND_ACTIVE_LOW = true;

// Alert thresholds. Raised at the threshold, cleared only once back under it minus the
// hysteresis: one Alert per transition, no flapping. Calibrate them on the real kit by watching
// the readings on the serial monitor or the dashboard.
constexpr int GAS_WARNING = 1500;          // MQ-2, millivolts at IO34 behind the divider (0–3300)
constexpr int GAS_CRITICAL = 2500;
constexpr int GAS_HYSTERESIS = 200;
constexpr uint32_t GAS_WARMUP_MS = 60000;  // the MQ-2 reads high while its heater warms up

constexpr float THERMAL_WARNING = 40.0f;   // °C
constexpr float THERMAL_CRITICAL = 55.0f;
constexpr float THERMAL_HYSTERESIS = 2.0f;

constexpr float NOISE_RAISE = 0.10f;       // a clap fills a couple of windows
constexpr float NOISE_QUIET = 0.05f;
constexpr uint32_t NOISE_HOLD_MS = 3000;   // quiet for this long before `noise` clears

constexpr uint32_t PIR_WARMUP_MS = 60000;  // the HC-SR501 triggers on its own while it settles
constexpr uint32_t PRESENCE_HOLD_MS = 5000;  // PIR low for this long before `presence` clears
