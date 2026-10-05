#pragma once

#include <Arduino.h>

#include "probes.h"

enum class Severity : uint8_t { None, Info, Warning, Critical };

const char *severityName(Severity severity);

// One transition of one Alert, as it goes on sentinel/<id>/alert.
struct AlertEvent {
  const char *kind;
  char alertId[32];
  Severity severity;  // the severity raised, or the one it had when cleared
  bool raised;
  float value;        // NAN: no triggering measurement
};

namespace alerts {

using Emit = void (*)(const AlertEvent &event);

void begin();
// Compares the readings to the thresholds and emits one event per transition. A change of
// severity is raised again on the same alert_id.
void evaluate(const Readings &readings, uint32_t now, Emit emit);
// Emits every Alert still raised, after a reconnection: the api replaces a raised by its id.
void reemitActive(Emit emit);
bool critical();
Severity worst();
// The active Alerts, short, for the LCD: "GAZ! TEMP PIR".
void describe(char *out, size_t size);

}  // namespace alerts
