#pragma once

#include <Arduino.h>

struct Readings {
  float temp = NAN;      // °C, NAN until the DHT22 answers once
  float humidity = NAN;  // %
  int air = 0;           // MQ-2, millivolts at IO34 (0–3300), 0 under the ADC's floor (~75 mV)
  bool pir = false;
  float sound = 0;       // share of the last cycle that was loud, 0–1
};

namespace probes {

void begin();
// Reads every Probe; call it once per cycle. Keeps the last good DHT22 values when a read fails.
void read(Readings &readings);

}  // namespace probes
